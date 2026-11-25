const fs = require('fs')
const path = require('path')
const https = require('https')
const crypto = require('crypto')
const { safeStorage, app } = require('electron')
const Database = require('better-sqlite3')

const OWNER = 'dovid-mendelowitz'
const REPO = 'proton-data'
const DB_NAME = 'proton.db'
const API_BASE = '/repos/' + OWNER + '/' + REPO
const DB_DIR = () => process.env.PROTON_DB_PATH || path.join(app.getPath('appData'), 'proton')
const DB_PATH = () => path.join(DB_DIR(), DB_NAME)
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'cloud-sync-config.json')
const STATE_PATH = () => path.join(app.getPath('userData'), 'cloud-sync-state.json')

function request(pathname, token, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? Buffer.from(options.body) : null
    const req = https.request({
      hostname: 'api.github.com',
      path: pathname,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Pruton-Desktop',
        'Accept': options.accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}),
      },
      timeout: 15000,
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const data = Buffer.concat(chunks)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data, headers: res.headers })
          return
        }
        let message = 'GitHub החזיר שגיאה (' + res.statusCode + ')'
        try { message = JSON.parse(data.toString('utf8')).message || message } catch {}
        const error = new Error(message)
        error.statusCode = res.statusCode
        reject(error)
      })
    })
    req.on('timeout', () => req.destroy(new Error('החיבור ל-GitHub נמשך זמן רב מדי')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function readToken() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8'))
    return safeStorage.decryptString(Buffer.from(config.token, 'base64'))
  } catch { return null }
}

function writeState(state) {
  const target = STATE_PATH()
  const temp = target + '.tmp'
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(temp, target)
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH(), 'utf8')) } catch { return null }
}

function gitBlobSha(buffer) {
  return crypto.createHash('sha1')
    .update('blob ' + buffer.length + '\0')
    .update(buffer)
    .digest('hex')
}

function checkpointDatabase() {
  const dbPath = DB_PATH()
  if (!fs.existsSync(dbPath)) return false
  const db = new Database(dbPath)
  try { db.pragma('wal_checkpoint(TRUNCATE)') } finally { db.close() }
  return true
}

function isDatabaseEmpty() {
  const dbPath = DB_PATH()
  if (!fs.existsSync(dbPath)) return true
  let db
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const tables = [
      'Accounts', 'Transactions', 'Savings_Goals', 'Indirect_Savings',
      'Recurring_Templates', 'Liabilities', 'Insurance_Policies', 'Assets', 'Informal_Debts',
    ]
    for (const table of tables) {
      try {
        if (db.prepare('SELECT 1 FROM "' + table + '" LIMIT 1').get()) return false
      } catch {}
    }
    try {
      if (db.prepare('SELECT 1 FROM Categories WHERE is_system_category=0 LIMIT 1').get()) return false
    } catch {}
    return true
  } catch {
    return false
  } finally {
    try { if (db) db.close() } catch {}
  }
}

async function getRemote(token) {
  try {
    const endpoint = API_BASE + '/contents/' + DB_NAME + '?ref=main'
    const metadata = await request(endpoint, token)
    const item = JSON.parse(metadata.data.toString('utf8'))
    return { sha: item.sha }
  } catch (error) {
    if (error.statusCode === 404) return null
    throw error
  }
}

async function getRemoteContent(token) {
  const endpoint = API_BASE + '/contents/' + DB_NAME + '?ref=main'
  const raw = await request(endpoint, token, { accept: 'application/vnd.github.raw+json' })
  return raw.data
}

async function uploadDatabase(token, buffer, remoteSha = null) {
  const payload = {
    message: 'Sync Pruton database',
    content: buffer.toString('base64'),
    branch: 'main',
    ...(remoteSha ? { sha: remoteSha } : {}),
  }
  const result = await request(API_BASE + '/contents/' + DB_NAME, token, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  const response = JSON.parse(result.data.toString('utf8'))
  const sha = response.content && response.content.sha
  if (!sha) throw new Error('GitHub לא החזיר אישור לשמירת מסד הנתונים')
  writeState({ remoteSha: sha, localDbSha: gitBlobSha(buffer), lastSyncAt: new Date().toISOString() })
  return { success: true, action: 'uploaded', sha }
}

function backupAndReplace(buffer) {
  const dbPath = DB_PATH()
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  let backup = null

  if (fs.existsSync(dbPath)) {
    checkpointDatabase()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    backup = path.join(path.dirname(dbPath), 'proton-before-cloud-sync-' + stamp + '.db')
    fs.copyFileSync(dbPath, backup)
  }

  const temp = dbPath + '.download'
  fs.writeFileSync(temp, buffer)
  if (buffer.subarray(0, 16).toString('binary') !== 'SQLite format 3\\0') {
    fs.rmSync(temp, { force: true })
    throw new Error('הקובץ שהתקבל מ-GitHub אינו מסד נתונים תקין')
  }

  try {
    fs.rmSync(dbPath + '-wal', { force: true })
    fs.rmSync(dbPath + '-shm', { force: true })
    fs.rmSync(dbPath, { force: true })
    fs.renameSync(temp, dbPath)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    if (backup && !fs.existsSync(dbPath)) fs.copyFileSync(backup, dbPath)
    throw error
  }
}

async function saveToken(token) {
  const clean = String(token || '').trim()
  if (!clean) throw new Error('יש להזין GitHub Token')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows אינו מאפשר כרגע שמירה מאובטחת של פרטי ההתחברות')
  }
  await request('/repos/' + OWNER + '/' + REPO, clean)
  const encrypted = safeStorage.encryptString(clean).toString('base64')
  fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true })
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify({ token: encrypted }), 'utf8')
  return { success: true }
}

function getStatus() {
  const state = readState()
  return {
    configured: Boolean(readToken()),
    lastSyncAt: state && state.lastSyncAt || null,
    repository: OWNER + '/' + REPO,
  }
}

async function syncAtStartup() {
  const token = readToken()
  if (!token) return { success: true, skipped: true }
  try {
    const remote = await getRemote(token)
    const dbPath = DB_PATH()
    if (!remote) {
      if (!fs.existsSync(dbPath)) return { success: true, skipped: true }
      checkpointDatabase()
      return await uploadDatabase(token, fs.readFileSync(dbPath))
    }

    if (!fs.existsSync(dbPath)) {
      const content = await getRemoteContent(token)
      backupAndReplace(content)
      writeState({ remoteSha: remote.sha, localDbSha: gitBlobSha(content), lastSyncAt: new Date().toISOString() })
      return { success: true, action: 'downloaded' }
    }

    checkpointDatabase()
    const local = fs.readFileSync(dbPath)
    const localSha = gitBlobSha(local)
    const state = readState()

    if (!state) {
      if (!isDatabaseEmpty()) {
        return { success: false, conflict: true, message: 'נמצאו נתונים מקומיים וגם נתונים ב-GitHub, אך אין היסטוריית סנכרון. לא שיניתי אף אחד מהם.' }
      }
      const content = await getRemoteContent(token)

      backupAndReplace(content)

      writeState({ remoteSha: remote.sha, localDbSha: gitBlobSha(content), lastSyncAt: new Date().toISOString() })
      return { success: true, action: 'downloaded' }
    }

    if (remote.sha === state.remoteSha && localSha === state.localDbSha) {
      return { success: true, action: 'unchanged' }
    }
    if (remote.sha === state.remoteSha && localSha !== state.localDbSha) {
      return await uploadDatabase(token, local, remote.sha)
    }
    if (remote.sha !== state.remoteSha && localSha === state.localDbSha) {
      const content = await getRemoteContent(token)

      backupAndReplace(content)

      writeState({ remoteSha: remote.sha, localDbSha: gitBlobSha(content), lastSyncAt: new Date().toISOString() })
      return { success: true, action: 'downloaded' }
    }
    return { success: false, conflict: true, message: 'נמצאו שינויים גם במחשב הזה וגם ב-GitHub. כדי למנוע דריסת נתונים, הסנכרון נעצר.' }
  } catch (error) {
    return { success: false, message: error.message }
  }
}

async function syncOnExit() {
  const token = readToken()
  if (!token) return { success: true, skipped: true }
  try {
    checkpointDatabase()
    const dbPath = DB_PATH()
    if (!fs.existsSync(dbPath)) return { success: true, skipped: true }
    const local = fs.readFileSync(dbPath)
    const localSha = gitBlobSha(local)
    const state = readState()
    const remote = await getRemote(token)

    if (!remote) return await uploadDatabase(token, local)
    if (!state) {
      if (isDatabaseEmpty()) {
        const content = await getRemoteContent(token)

        backupAndReplace(content)

        writeState({ remoteSha: remote.sha, localDbSha: gitBlobSha(content), lastSyncAt: new Date().toISOString() })
        return { success: true, action: 'downloaded' }
      }
      return { success: false, conflict: true, message: 'קיימים נתונים בענן ללא היסטוריית סנכרון. לא דרסתי נתונים.' }
    }
    if (remote.sha !== state.remoteSha) {
      return { success: false, conflict: true, message: 'עותק הענן השתנה מאז הסנכרון האחרון. לא העליתי את הקובץ המקומי כדי למנוע דריסת נתונים.' }
    }
    if (localSha === state.localDbSha) return { success: true, action: 'unchanged' }
    return await uploadDatabase(token, local, remote.sha)
  } catch (error) {
    return { success: false, message: error.message }
  }
}

module.exports = {
  saveToken,
  getStatus,
  syncAtStartup,
  syncOnExit,
  hasSavedToken: () => Boolean(readToken()),
}
