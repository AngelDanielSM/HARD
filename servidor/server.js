import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'node:path';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const dir = path.dirname(fileURLToPath(import.meta.url));
const scrypt = promisify(scryptCallback);
const db = await open({ filename: path.join(dir, 'database.sqlite'), driver: sqlite3.Database });
await db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
await db.exec(`
CREATE TABLE IF NOT EXISTS usuarios(id INTEGER PRIMARY KEY,nombre TEXT NOT NULL,rol TEXT NOT NULL CHECK(rol IN ('admin','ensamblador','visor')),color_avatar TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proyectos(id INTEGER PRIMARY KEY,nombre TEXT NOT NULL,descripcion TEXT DEFAULT '',estado TEXT NOT NULL DEFAULT 'No empezado' CHECK(estado IN ('No empezado','En progreso','Terminado')),fecha_creacion TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,distribucion_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS componentes_catalogo(id INTEGER PRIMARY KEY,nombre TEXT NOT NULL,tipo TEXT NOT NULL,pinout_json TEXT NOT NULL DEFAULT '[]',datasheet_path TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS nodos_lienzo(id INTEGER PRIMARY KEY,proyecto_id INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,componente_id INTEGER NOT NULL REFERENCES componentes_catalogo(id),pos_x REAL NOT NULL DEFAULT 0,pos_y REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS cables(id INTEGER PRIMARY KEY,proyecto_id INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,pin_origen_id TEXT NOT NULL,pin_destino_id TEXT NOT NULL,calibre TEXT DEFAULT '18 AWG',color TEXT DEFAULT '#38bdf8',material TEXT DEFAULT 'Cobre',etiqueta TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS empalmes_lienzo(id INTEGER PRIMARY KEY,proyecto_id INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,nombre TEXT NOT NULL DEFAULT 'Crimp',pos_x REAL NOT NULL DEFAULT 0,pos_y REAL NOT NULL DEFAULT 0,color TEXT NOT NULL DEFAULT '#4388d1');
CREATE TABLE IF NOT EXISTS historial_cambios(id INTEGER PRIMARY KEY,proyecto_id INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,usuario_id INTEGER REFERENCES usuarios(id),accion TEXT NOT NULL,timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS proyecto_versiones(id INTEGER PRIMARY KEY AUTOINCREMENT,proyecto_id INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,revision INTEGER NOT NULL,parent_revision INTEGER,actor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,actor_nombre TEXT NOT NULL,accion TEXT NOT NULL,motivo TEXT NOT NULL DEFAULT '',antes_json TEXT,snapshot_json TEXT NOT NULL,cambios_json TEXT NOT NULL DEFAULT '[]',hash_anterior TEXT NOT NULL,hash TEXT NOT NULL,creado_en TEXT NOT NULL,UNIQUE(proyecto_id,revision));
CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,expires_at TEXT NOT NULL);
`);
const columnasUsuarios = new Set((await db.all('PRAGMA table_info(usuarios)')).map(c => c.name));
if (!columnasUsuarios.has('password_hash')) await db.exec('ALTER TABLE usuarios ADD COLUMN password_hash TEXT');
if (!columnasUsuarios.has('avatar_data')) await db.exec('ALTER TABLE usuarios ADD COLUMN avatar_data TEXT');
const columnasCables = new Set((await db.all('PRAGMA table_info(cables)')).map(c => c.name));
if (!columnasCables.has('longitud_mm')) await db.exec('ALTER TABLE cables ADD COLUMN longitud_mm REAL');
if (!columnasCables.has('grupo_cable')) await db.exec("ALTER TABLE cables ADD COLUMN grupo_cable TEXT NOT NULL DEFAULT ''");
if (!columnasCables.has('color_funda')) await db.exec("ALTER TABLE cables ADD COLUMN color_funda TEXT NOT NULL DEFAULT '#59636a'");

// Los grupos convierten conjuntos de nodos/cables en subensambles movibles y bloqueables.
const columnasNodos = new Set((await db.all('PRAGMA table_info(nodos_lienzo)')).map(c => c.name));
for (const [nombre,tipo] of [['grupo_id','TEXT'],['bloqueado','INTEGER NOT NULL DEFAULT 0'],['huella_x','REAL'],['huella_y','REAL']]) {
  if (!columnasNodos.has(nombre)) await db.exec(`ALTER TABLE nodos_lienzo ADD COLUMN ${nombre} ${tipo}`);
}
const columnasProyectos = new Set((await db.all('PRAGMA table_info(proyectos)')).map(c => c.name));
if (!columnasProyectos.has('hoja_json')) await db.exec("ALTER TABLE proyectos ADD COLUMN hoja_json TEXT NOT NULL DEFAULT '{}'");
if (!columnasProyectos.has('distribucion_json')) await db.exec("ALTER TABLE proyectos ADD COLUMN distribucion_json TEXT NOT NULL DEFAULT '{}'");

// Amplía de forma segura bases creadas por versiones anteriores del laboratorio.
const columnasComponentes = await db.all('PRAGMA table_info(componentes_catalogo)');
const columnasExistentes = new Set(columnasComponentes.map(columna => columna.name));
for (const [nombre,tipo] of [['modelo','TEXT NOT NULL DEFAULT \'\''],['numero_interno','TEXT NOT NULL DEFAULT \'\''],['descripcion','TEXT NOT NULL DEFAULT \'\''],['url','TEXT NOT NULL DEFAULT \'\''],['color','TEXT NOT NULL DEFAULT \'\''],['shell','INTEGER NOT NULL DEFAULT 0'],['pin_count','INTEGER NOT NULL DEFAULT 2 CHECK(pin_count BETWEEN 2 AND 22)'],['circunferencia','TEXT NOT NULL DEFAULT \'M12\''],['marca','TEXT NOT NULL DEFAULT \'\''],['material','TEXT NOT NULL DEFAULT \'\''],['precio_unitario','REAL NOT NULL DEFAULT 0'],['familia','TEXT NOT NULL DEFAULT \'Circular\''],['genero','TEXT NOT NULL DEFAULT \'Hembra\''],['pin_positions_json','TEXT NOT NULL DEFAULT \'{}\''],['pin_colors_json','TEXT NOT NULL DEFAULT \'{}\'']]) {
  if (!columnasExistentes.has(nombre)) await db.exec(`ALTER TABLE componentes_catalogo ADD COLUMN ${nombre} ${tipo}`);
}

// Semillas locales para poder probar los perfiles y el catálogo al iniciar.
if (!(await db.get('SELECT COUNT(*) AS n FROM usuarios')).n) {
  const insert = await db.prepare('INSERT INTO usuarios(nombre,rol,color_avatar) VALUES(?,?,?)');
  try {
    for (const user of [['Alex Rivera','admin','#38bdf8'],['Mara López','ensamblador','#a78bfa'],['Visor de laboratorio','visor','#34d399']]) await insert.run(user);
  } finally { await insert.finalize(); }
}
const setupKeyPath=path.join(dir,'auth-setup.key');
const unclaimedProfiles=(await db.get('SELECT COUNT(*) AS n FROM usuarios WHERE password_hash IS NULL')).n;
let bootstrapSetupKey='';
if(unclaimedProfiles){
  try{bootstrapSetupKey=(await readFile(setupKeyPath,'utf8')).trim()}catch{}
  if(!bootstrapSetupKey){bootstrapSetupKey=randomBytes(16).toString('hex');await writeFile(setupKeyPath,bootstrapSetupKey,{encoding:'utf8',mode:0o600});}
  console.warn(`[AUTENTICACIÓN] Código inicial de contraseña (solo perfiles antiguos): ${bootstrapSetupKey}`);
}else{try{await unlink(setupKeyPath)}catch{}}
if (!(await db.get('SELECT COUNT(*) AS n FROM componentes_catalogo')).n) {
  const insert = await db.prepare('INSERT INTO componentes_catalogo(nombre,tipo,pinout_json,datasheet_path) VALUES(?,?,?,?)');
  const components = [
    ['Conector Deutsch DT04-2P','Conector',['1 · Alimentación','2 · Retorno']],
    ['Fusible mini 10 A','Protección',['1 · Entrada','2 · Salida']],
    ['Sensor de temperatura NTC','Sensor',['VCC','GND','SIG']],
    ['Empalme sellado 3 vías','Empalme',['A','B','C']]
  ];
  try { for (const [name,type,pins] of components) await insert.run([name,type,JSON.stringify(pins),'']); }
  finally { await insert.finalize(); }
}

const app = express();
app.use(cors());
app.use(express.json({limit:'2mb'}));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE'] } });

const parseJson = (value, fallback={}) => { try { return JSON.parse(value ?? ''); } catch { return fallback; } };
async function projectSnapshot(projectId) {
  const project=await db.get('SELECT id,nombre,descripcion,estado,fecha_creacion,distribucion_json,hoja_json FROM proyectos WHERE id=?',[projectId]);
  if(!project)return null;
  const [nodes,splices,cables]=await Promise.all([
    db.all('SELECT n.*,c.nombre componente_nombre,c.modelo,c.pinout_json,c.pin_positions_json,c.pin_colors_json FROM nodos_lienzo n JOIN componentes_catalogo c ON c.id=n.componente_id WHERE n.proyecto_id=? ORDER BY n.id',[projectId]),
    db.all('SELECT * FROM empalmes_lienzo WHERE proyecto_id=? ORDER BY id',[projectId]),
    db.all('SELECT * FROM cables WHERE proyecto_id=? ORDER BY id',[projectId]),
  ]);
  return {project,nodes,splices,cables};
}
function versionChanges(before,after) {
  if(!before)return [{elemento:'Proyecto',accion:'Línea base registrada'}];
  const changes=[];
  const compareObject=(elemento,id,oldValue,newValue)=>{
    const keys=new Set([...Object.keys(oldValue||{}),...Object.keys(newValue||{})]);
    for(const key of keys){
      const a=oldValue?.[key],b=newValue?.[key];
      if(JSON.stringify(a)===JSON.stringify(b))continue;
      changes.push({elemento,id,accion:'campo actualizado',campo:key,antes:a??null,despues:b??null});
    }
  };
  compareObject('Proyecto',after.project.id,before.project,after.project);
  for(const [collection,label] of [['nodes','Conector'],['splices','Crimp'],['cables','Cable']]){
    const oldItems=new Map((before[collection]||[]).map(item=>[String(item.id),item]));
    const newItems=new Map((after[collection]||[]).map(item=>[String(item.id),item]));
    for(const [id,item] of newItems){
      const previous=oldItems.get(id);
      if(!previous){changes.push({elemento:label,id,accion:'añadido',despues:item});continue;}
      compareObject(label,id,previous,item);
    }
    for(const [id,item] of oldItems)if(!newItems.has(id))changes.push({elemento:label,id,accion:'eliminado',antes:item});
  }
  return changes;
}
function calculateVersionHash(version) {
  const payload={proyecto_id:Number(version.proyecto_id),revision:Number(version.revision),parent_revision:version.parent_revision==null?null:Number(version.parent_revision),actor_id:version.actor_id==null?null:Number(version.actor_id),actor_nombre:version.actor_nombre,accion:version.accion,motivo:version.motivo||'',antes_json:version.antes_json||null,snapshot_json:version.snapshot_json,cambios_json:version.cambios_json,hash_anterior:version.hash_anterior,creado_en:version.creado_en};
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
const versionQueues=new Map();
async function record(projectId, userId, action, {beforeSnapshot=null,reason='',parentRevision=null}={}) {
  const key=Number(projectId),previous=versionQueues.get(key)||Promise.resolve();let release;
  const lock=new Promise(resolve=>{release=resolve}),queued=previous.then(()=>lock);versionQueues.set(key,queued);
  await previous;
  try {
  const snapshot=await projectSnapshot(projectId);if(!snapshot)return null;
  const latest=await db.get('SELECT revision,snapshot_json,hash FROM proyecto_versiones WHERE proyecto_id=? ORDER BY revision DESC LIMIT 1',[projectId]);
  const before=beforeSnapshot||(latest?parseJson(latest.snapshot_json,null):null);
  const revision=(latest?.revision||0)+1,actor=userId?await db.get('SELECT id,nombre FROM usuarios WHERE id=?',[userId]):null;
  const antesJson=before?JSON.stringify(before):null,snapshotJson=JSON.stringify(snapshot),cambiosJson=JSON.stringify(versionChanges(before,snapshot)),creadoEn=new Date().toISOString();
  const row={proyecto_id:projectId,revision,parent_revision:parentRevision,actor_id:actor?.id??null,actor_nombre:actor?.nombre||'Usuario desconocido',accion:String(action),motivo:String(reason||''),antes_json:antesJson,snapshot_json:snapshotJson,cambios_json:cambiosJson,hash_anterior:latest?.hash||'0'.repeat(64),creado_en:creadoEn};
  row.hash=calculateVersionHash(row);
  await db.run('INSERT INTO proyecto_versiones(proyecto_id,revision,parent_revision,actor_id,actor_nombre,accion,motivo,antes_json,snapshot_json,cambios_json,hash_anterior,hash,creado_en) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',[row.proyecto_id,row.revision,row.parent_revision,row.actor_id,row.actor_nombre,row.accion,row.motivo,row.antes_json,row.snapshot_json,row.cambios_json,row.hash_anterior,row.hash,row.creado_en]);
  await db.run('INSERT INTO historial_cambios(proyecto_id,usuario_id,accion,timestamp) VALUES(?,?,?,?)',[projectId,row.actor_id,row.accion,row.creado_en]);
  return row;

  } finally {release();if(versionQueues.get(key)===queued)queued.then(()=>{if(versionQueues.get(key)===queued)versionQueues.delete(key)});}
}
async function ensureProjectBaseline(projectId,userId) {
  if(!(await db.get('SELECT id FROM proyecto_versiones WHERE proyecto_id=? LIMIT 1',[projectId])))await record(projectId,userId,'Línea base inicial');
}
async function restoreProjectSnapshot(projectId,snapshot) {
  const missing=[];
  for(const node of snapshot.nodes||[])if(!(await db.get('SELECT id FROM componentes_catalogo WHERE id=?',[node.componente_id])))missing.push(node.componente_nombre||`componente ${node.componente_id}`);
  if(missing.length)throw new Error(`No se puede restaurar porque faltan componentes de catálogo: ${missing.join(', ')}.`);
  const nodeMap=new Map(),spliceMap=new Map();
  await db.exec('BEGIN IMMEDIATE');
  try {
    await db.run('DELETE FROM cables WHERE proyecto_id=?',[projectId]);
    await db.run('DELETE FROM empalmes_lienzo WHERE proyecto_id=?',[projectId]);
    await db.run('DELETE FROM nodos_lienzo WHERE proyecto_id=?',[projectId]);
    for(const node of snapshot.nodes||[]){
      const occupied=await db.get('SELECT proyecto_id FROM nodos_lienzo WHERE id=?',[node.id]);
      const fields=[projectId,node.componente_id,node.pos_x,node.pos_y,node.grupo_id??null,node.bloqueado??0,node.huella_x??null,node.huella_y??null];
      let id;
      if(!occupied){await db.run('INSERT INTO nodos_lienzo(id,proyecto_id,componente_id,pos_x,pos_y,grupo_id,bloqueado,huella_x,huella_y) VALUES(?,?,?,?,?,?,?,?,?)',[node.id,...fields]);id=Number(node.id);}
      else id=(await db.run('INSERT INTO nodos_lienzo(proyecto_id,componente_id,pos_x,pos_y,grupo_id,bloqueado,huella_x,huella_y) VALUES(?,?,?,?,?,?,?,?)',fields)).lastID;
      nodeMap.set(String(node.id),String(id));
    }
    for(const splice of snapshot.splices||[]){
      const occupied=await db.get('SELECT proyecto_id FROM empalmes_lienzo WHERE id=?',[splice.id]);
      const fields=[projectId,splice.nombre,splice.pos_x,splice.pos_y,splice.color];let id;
      if(!occupied){await db.run('INSERT INTO empalmes_lienzo(id,proyecto_id,nombre,pos_x,pos_y,color) VALUES(?,?,?,?,?,?)',[splice.id,...fields]);id=Number(splice.id);}
      else id=(await db.run('INSERT INTO empalmes_lienzo(proyecto_id,nombre,pos_x,pos_y,color) VALUES(?,?,?,?,?)',fields)).lastID;
      spliceMap.set(String(splice.id),String(id));
    }
    const rewriteEndpoint=value=>{const [rawId,pin]=String(value).split(':');if(rawId.startsWith('splice-')){const mapped=spliceMap.get(rawId.slice(7));if(!mapped)throw new Error(`El historial contiene una conexión a un crimp inexistente (${rawId}).`);return `splice-${mapped}:${pin}`;}const mapped=nodeMap.get(rawId);if(!mapped)throw new Error(`El historial contiene una conexión a un componente inexistente (${rawId}).`);return `${mapped}:${pin}`;};
    for(const cable of snapshot.cables||[]){
      const occupied=await db.get('SELECT proyecto_id FROM cables WHERE id=?',[cable.id]);
      const fields=[projectId,rewriteEndpoint(cable.pin_origen_id),rewriteEndpoint(cable.pin_destino_id),cable.calibre,cable.color,cable.material,cable.etiqueta,cable.longitud_mm??null,cable.grupo_cable||'',cable.color_funda||'#59636a'];
      if(!occupied)await db.run('INSERT INTO cables(id,proyecto_id,pin_origen_id,pin_destino_id,calibre,color,material,etiqueta,longitud_mm,grupo_cable,color_funda) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[cable.id,...fields]);
      else await db.run('INSERT INTO cables(proyecto_id,pin_origen_id,pin_destino_id,calibre,color,material,etiqueta,longitud_mm,grupo_cable,color_funda) VALUES(?,?,?,?,?,?,?,?,?,?)',fields);
    }
    const sourceDistribution=parseJson(snapshot.project.distribucion_json,{});
    const distribution=Object.fromEntries(Object.entries(sourceDistribution).map(([key,value])=>[nodeMap.get(key)||key,value]));
    await db.run('UPDATE proyectos SET nombre=?,descripcion=?,estado=?,fecha_creacion=?,distribucion_json=?,hoja_json=? WHERE id=?',[snapshot.project.nombre,snapshot.project.descripcion,snapshot.project.estado,snapshot.project.fecha_creacion,JSON.stringify(distribution),snapshot.project.hoja_json||'{}',projectId]);
    await db.exec('COMMIT');
  } catch(error) { await db.exec('ROLLBACK'); throw error; }
}
function asyncRoute(handler) {
  return (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);
}
const authUser = user => user && ({id:user.id,nombre:user.nombre,rol:user.rol,color_avatar:user.color_avatar,avatar_data:user.avatar_data||null});
const tokenDigest = token => createHash('sha256').update(token).digest('hex');
const validatePassword = value => typeof value==='string' && value.length>=10 && value.length<=200;
async function hashPassword(value){const salt=randomBytes(16);const key=await scrypt(value,salt,64);return `scrypt$${salt.toString('hex')}$${Buffer.from(key).toString('hex')}`;}
async function verifyPassword(value,encoded){const [scheme,saltHex,keyHex]=String(encoded||'').split('$');if(scheme!=='scrypt'||!saltHex||!keyHex)return false;const actual=Buffer.from(await scrypt(value,Buffer.from(saltHex,'hex'),Buffer.from(keyHex,'hex').length));const expected=Buffer.from(keyHex,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
async function createSession(userId,remember){const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+(remember?30:1)*24*60*60*1000).toISOString();await db.run('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',[tokenDigest(token),userId,expiresAt]);return{token,expiresAt};}
async function sessionUser(token){if(!token)return null;const session=await db.get('SELECT u.* FROM auth_sessions s JOIN usuarios u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',[tokenDigest(token),new Date().toISOString()]);return authUser(session);}
const requestToken=req=>/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'')?.[1]||'';

app.get('/api/health', (_req,res) => res.json({ok:true,servicio:'arneses-lab'}));
app.post('/api/auth/login',asyncRoute(async(req,res)=>{const{userId,password,remember=false}=req.body||{},user=await db.get('SELECT * FROM usuarios WHERE id=?',[Number(userId)]);if(!user)return res.status(401).json({error:'Perfil o contraseña incorrectos.'});if(!user.password_hash)return res.status(409).json({code:'PASSWORD_SETUP_REQUIRED',error:'Define una contraseña para este perfil antes de continuar.'});if(typeof password!=='string'||!await verifyPassword(password,user.password_hash))return res.status(401).json({error:'Perfil o contraseña incorrectos.'});const session=await createSession(user.id,!!remember);res.json({...session,user:authUser(user)});}));
app.post('/api/auth/setup-password',asyncRoute(async(req,res)=>{const{userId,password,remember=false,setupKey=''}=req.body||{},user=await db.get('SELECT * FROM usuarios WHERE id=?',[Number(userId)]);if(!user)return res.status(404).json({error:'Perfil no encontrado.'});if(user.password_hash)return res.status(409).json({error:'Este perfil ya tiene contraseña. Inicia sesión.'});const received=Buffer.from(String(setupKey)),expected=Buffer.from(bootstrapSetupKey);if(!bootstrapSetupKey||received.length!==expected.length||!timingSafeEqual(received,expected))return res.status(403).json({error:'Código inicial incorrecto. Consulta la consola del servidor local.'});if(!validatePassword(password))return res.status(400).json({error:'Usa una contraseña de 10 a 200 caracteres.'});await db.run('UPDATE usuarios SET password_hash=? WHERE id=? AND password_hash IS NULL',[await hashPassword(password),user.id]);const updated=await db.get('SELECT * FROM usuarios WHERE id=?',[user.id]);const session=await createSession(user.id,!!remember);if(!(await db.get('SELECT COUNT(*) AS n FROM usuarios WHERE password_hash IS NULL')).n){bootstrapSetupKey='';try{await unlink(setupKeyPath)}catch{}}res.status(201).json({...session,user:authUser(updated)});}));
app.post('/api/auth/register',asyncRoute(async(req,res)=>{const{nombre,password,remember=false}=req.body||{};if(!String(nombre||'').trim())return res.status(400).json({error:'El nombre es obligatorio.'});if(!validatePassword(password))return res.status(400).json({error:'Usa una contraseña de 10 a 200 caracteres.'});const result=await db.run('INSERT INTO usuarios(nombre,rol,color_avatar,password_hash) VALUES(?,?,?,?)',[String(nombre).trim(),'ensamblador','#38bdf8',await hashPassword(password)]);const user=await db.get('SELECT * FROM usuarios WHERE id=?',[result.lastID]),session=await createSession(user.id,!!remember);res.status(201).json({...session,user:authUser(user)});}));
app.get('/api/auth/session',asyncRoute(async(req,res)=>{const user=await sessionUser(requestToken(req));if(!user)return res.status(401).json({error:'La sesión expiró. Inicia sesión otra vez.'});res.json({user});}));
app.post('/api/auth/logout',asyncRoute(async(req,res)=>{const token=requestToken(req);if(token)await db.run('DELETE FROM auth_sessions WHERE token_hash=?',[tokenDigest(token)]);res.status(204).end();}));
app.get('/api/usuarios', asyncRoute(async (_req,res) => res.json(await db.all('SELECT id,nombre,rol,color_avatar,avatar_data,CASE WHEN password_hash IS NULL THEN 1 ELSE 0 END AS needs_setup FROM usuarios ORDER BY id'))));
app.use('/api',asyncRoute(async(req,res,next)=>{if(req.method==='GET'&&req.path==='/usuarios')return next();const user=await sessionUser(requestToken(req));if(!user)return res.status(401).json({error:'Se requiere una sesión válida.'});req.user=user;next();}));
app.post('/api/usuarios', asyncRoute(async (req,res) => {
  const {nombre,rol='ensamblador',color_avatar='#38bdf8',password} = req.body ?? {};
  if(req.user.rol!=='admin')return res.status(403).json({error:'Solo un administrador puede agregar perfiles.'});
  if (!nombre?.trim()) return res.status(400).json({error:'El nombre es obligatorio.'});
  if (!['admin','ensamblador','visor'].includes(rol)) return res.status(400).json({error:'El rol no es válido.'});
  if(!validatePassword(password))return res.status(400).json({error:'Usa una contraseña de 10 a 200 caracteres.'});
  const result = await db.run('INSERT INTO usuarios(nombre,rol,color_avatar,password_hash) VALUES(?,?,?,?)',[nombre.trim(),rol,color_avatar,await hashPassword(password)]);
  res.status(201).json(await db.get('SELECT id,nombre,rol,color_avatar FROM usuarios WHERE id=?',[result.lastID]));
}));
app.delete('/api/usuarios/:id', asyncRoute(async (req,res) => {
  if(req.user.rol!=='admin')return res.status(403).json({error:'Solo un administrador puede quitar perfiles.'});
  const id = Number(req.params.id);
  const user = await db.get('SELECT id,rol FROM usuarios WHERE id=?',[id]);
  if (!user) return res.status(404).json({error:'Usuario no encontrado.'});
  if (user.rol === 'admin' && (await db.get("SELECT COUNT(*) AS n FROM usuarios WHERE rol='admin'")).n <= 1) return res.status(409).json({error:'No se puede eliminar al último administrador.'});
  await db.run('UPDATE historial_cambios SET usuario_id=NULL WHERE usuario_id=?',[id]);
  await db.run('DELETE FROM usuarios WHERE id=?',[id]);
  res.status(204).end();
}));
app.patch('/api/usuarios/:id', asyncRoute(async (req,res) => {
  const id = Number(req.params.id);
  const current = await db.get('SELECT * FROM usuarios WHERE id=?',[id]);
  if (!current) return res.status(404).json({error:'Perfil no encontrado.'});
  const isAdmin = req.user.rol === 'admin';
  const isSelf = Number(req.user.id) === id;
  if (!isAdmin && !isSelf) return res.status(403).json({error:'Solo puedes editar tu propio perfil.'});
  const body = req.body || {};
  const nombre = Object.hasOwn(body,'nombre') ? String(body.nombre).trim() : current.nombre;
  const rol = isAdmin && Object.hasOwn(body,'rol') ? String(body.rol) : current.rol;
  const color = Object.hasOwn(body,'color_avatar') ? String(body.color_avatar) : current.color_avatar;
  const avatar = Object.hasOwn(body,'avatar_data') ? body.avatar_data : current.avatar_data;
  if (!nombre || nombre.length > 80) return res.status(400).json({error:'El nombre debe tener entre 1 y 80 caracteres.'});
  if (Object.hasOwn(body,'rol') && !isAdmin) return res.status(403).json({error:'Solo un administrador puede cambiar roles.'});
  if (!['admin','ensamblador','visor'].includes(rol)) return res.status(400).json({error:'El rol no es válido.'});
  if (!/^#[0-9a-f]{6}$/i.test(color)) return res.status(400).json({error:'El color de perfil no es válido.'});
  if (avatar !== null && avatar !== undefined && (typeof avatar !== 'string' || avatar.length > 1500000 || !/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/]+=*$/i.test(avatar))) return res.status(400).json({error:'La imagen debe ser PNG, JPG, WEBP o GIF y no superar 1 MB.'});
  if (current.rol === 'admin' && rol !== 'admin' && (await db.get("SELECT COUNT(*) AS n FROM usuarios WHERE rol='admin'")).n <= 1) return res.status(409).json({error:'No se puede quitar el último perfil administrador.'});
  const newPassword = typeof body.new_password === 'string' ? body.new_password : '';
  if (newPassword && !validatePassword(newPassword)) return res.status(400).json({error:'La nueva contraseña debe tener entre 10 y 200 caracteres.'});
  if (newPassword && isSelf && current.password_hash && !await verifyPassword(String(body.current_password||''),current.password_hash)) return res.status(401).json({error:'La contraseña actual no coincide.'});
  const passwordHash = newPassword ? await hashPassword(newPassword) : current.password_hash;
  await db.run('UPDATE usuarios SET nombre=?,rol=?,color_avatar=?,avatar_data=?,password_hash=? WHERE id=?',[nombre,rol,color,avatar||null,passwordHash,id]);
  res.json(authUser(await db.get('SELECT * FROM usuarios WHERE id=?',[id])));
}));
app.get('/api/componentes', asyncRoute(async (_req,res) => {
  const components = await db.all('SELECT * FROM componentes_catalogo ORDER BY id');
  res.json(components.map(c => ({...c,pinout:JSON.parse(c.pinout_json),pin_positions:JSON.parse(c.pin_positions_json||'{}'),pin_colors:JSON.parse(c.pin_colors_json||'{}')})));
}));
app.post('/api/componentes', asyncRoute(async (req,res) => {
  const {nombre,modelo,numero_interno='',descripcion='',url='',color='',shell=false,marca='',familia='Circular',genero='Hembra',pin_count,circunferencia='M12',material='',precio_unitario=0,pinout=[],pin_positions={},pin_colors={},datasheet_path=''} = req.body ?? {};
  const cantidad = Number(pin_count);
  const precio = Number(precio_unitario);
  if (!nombre?.trim() || !modelo?.trim()) return res.status(400).json({error:'El nombre y el modelo son obligatorios.'});
  if (!Number.isInteger(cantidad) || cantidad < 2 || cantidad > 22) return res.status(400).json({error:'La cantidad de pines debe ser un entero entre 2 y 22.'});
  if (!Number.isFinite(precio) || precio < 0) return res.status(400).json({error:'El precio debe ser un número igual o mayor que cero.'});
  if (!['Hembra','Macho'].includes(genero)) return res.status(400).json({error:'El género debe ser Hembra o Macho.'});
  if (!['Circular','RJ45','JR','JST'].includes(familia)) return res.status(400).json({error:'La familia del conector no es válida.'});
  const etiquetas = Array.from({length:cantidad},(_,i)=>String(pinout[i] ?? '').slice(0,80));
  const result = await db.run('INSERT INTO componentes_catalogo(nombre,tipo,pinout_json,datasheet_path,modelo,numero_interno,descripcion,url,color,shell,pin_count,circunferencia,marca,material,precio_unitario,familia,genero,pin_positions_json,pin_colors_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[nombre.trim(),familia==='Circular'?'Conector circular':`Conector ${familia}`,JSON.stringify(etiquetas),datasheet_path,modelo.trim(),numero_interno.trim(),descripcion.trim(),url.trim(),color.trim(),shell?1:0,cantidad,circunferencia.trim(),marca.trim(),material.trim(),precio,familia,genero,JSON.stringify(pin_positions),JSON.stringify(pin_colors)]);
  const component = await db.get('SELECT * FROM componentes_catalogo WHERE id=?',[result.lastID]);
  res.status(201).json({...component,pinout:JSON.parse(component.pinout_json),pin_positions:JSON.parse(component.pin_positions_json),pin_colors:JSON.parse(component.pin_colors_json)});
}));
app.patch('/api/componentes/:id', asyncRoute(async (req,res) => {
  const id=Number(req.params.id);
  const component=await db.get('SELECT * FROM componentes_catalogo WHERE id=?',[id]);
  if(!component)return res.status(404).json({error:'Componente no encontrado.'});
  const pinout=req.body.pinout;
  const positions=req.body.pin_positions;
  const colors=req.body.pin_colors;
  if(pinout!==undefined&&(!Array.isArray(pinout)||pinout.length!==component.pin_count))return res.status(400).json({error:'El pinout debe incluir una entrada por cada pin.'});
  if(['nombre','modelo'].some(field=>Object.hasOwn(req.body,field)&&!String(req.body[field]||'').trim()))return res.status(400).json({error:'El nombre visible y el número de parte no pueden quedar vacíos.'});
  if(Object.hasOwn(req.body,'precio_unitario')&&(!Number.isFinite(Number(req.body.precio_unitario))||Number(req.body.precio_unitario)<0))return res.status(400).json({error:'El precio debe ser un número igual o mayor que cero.'});
  if(Object.hasOwn(req.body,'familia')&&!['Circular','RJ45','JR','JST'].includes(req.body.familia))return res.status(400).json({error:'La familia del conector no es válida.'});
  if(Object.hasOwn(req.body,'genero')&&!['Hembra','Macho'].includes(req.body.genero))return res.status(400).json({error:'El género debe ser Hembra o Macho.'});
  // Solo se actualizan columnas permitidas, y se mantienen los pinouts existentes si no vienen en la petición.
  const allowedFields=['nombre','modelo','numero_interno','descripcion','url','color','marca','familia','genero','circunferencia','material','precio_unitario','shell'];
  const updates=[];const values=[];
  for(const field of allowedFields)if(Object.hasOwn(req.body,field)){updates.push(`${field}=?`);values.push(field==='shell'?(req.body[field]?1:0):req.body[field]);}
  if(pinout!==undefined){updates.push('pinout_json=?');values.push(JSON.stringify(pinout));}
  if(positions!==undefined){updates.push('pin_positions_json=?');values.push(JSON.stringify(positions));}
  if(colors!==undefined){updates.push('pin_colors_json=?');values.push(JSON.stringify(colors));}
  if(updates.length)await db.run(`UPDATE componentes_catalogo SET ${updates.join(',')} WHERE id=?`,[...values,id]);
  const updated=await db.get('SELECT * FROM componentes_catalogo WHERE id=?',[id]);
  res.json({...updated,pinout:JSON.parse(updated.pinout_json),pin_positions:JSON.parse(updated.pin_positions_json||'{}'),pin_colors:JSON.parse(updated.pin_colors_json||'{}')});
}));
app.get('/api/proyectos', asyncRoute(async (_req,res) => res.json(await db.all('SELECT * FROM proyectos ORDER BY id DESC'))));
app.post('/api/proyectos', asyncRoute(async (req,res) => {
  const {nombre,descripcion=''} = req.body ?? {};
  if (!nombre?.trim()) return res.status(400).json({error:'El nombre es obligatorio.'});
  const result = await db.run('INSERT INTO proyectos(nombre,descripcion) VALUES(?,?)',[nombre.trim(),descripcion]);
  const project = await db.get('SELECT * FROM proyectos WHERE id=?',[result.lastID]);
  io.emit('project:created',project);
  res.status(201).json(project);
}));
// Permite administrar los metadatos sin reemplazar el contenido del arnés.
app.patch('/api/proyectos/:id', asyncRoute(async (req,res) => {
  const id=Number(req.params.id), current=await db.get('SELECT * FROM proyectos WHERE id=?',[id]);
  if(!current)return res.status(404).json({error:'Proyecto no encontrado.'});
  const {nombre=current.nombre,descripcion=current.descripcion,estado=current.estado,usuario_id=null}=req.body||{};
  if(!String(nombre).trim())return res.status(400).json({error:'El nombre del proyecto es obligatorio.'});
  if(!['No empezado','En progreso','Terminado'].includes(estado))return res.status(400).json({error:'El estado del proyecto no es válido.'});
  const beforeSnapshot=await projectSnapshot(id);
  await db.run('UPDATE proyectos SET nombre=?,descripcion=?,estado=? WHERE id=?',[String(nombre).trim(),String(descripcion||'').trim(),estado,id]);
  const project=await db.get('SELECT * FROM proyectos WHERE id=?',[id]);
  await record(id,req.user.id,'Datos del proyecto actualizados',{beforeSnapshot});
  io.emit('project:updated',project);
  res.json(project);
}));
// La relación en cascada elimina nodos, cables e historial junto con el proyecto.
app.delete('/api/proyectos/:id', asyncRoute(async (req,res) => {
  const id=Number(req.params.id), project=await db.get('SELECT id FROM proyectos WHERE id=?',[id]);
  if(!project)return res.status(404).json({error:'Proyecto no encontrado.'});
  await db.run('DELETE FROM proyectos WHERE id=?',[id]);
  io.emit('project:deleted',{id});
  res.status(204).end();
}));
app.get('/api/proyectos/:id', asyncRoute(async (req,res) => {
  const id = Number(req.params.id);
  const project = await db.get('SELECT * FROM proyectos WHERE id=?',[id]);
  if (!project) return res.status(404).json({error:'Proyecto no encontrado.'});
  await ensureProjectBaseline(id,req.user.id);
  const nodes = await db.all('SELECT n.*,c.nombre componente_nombre,c.modelo,c.tipo,c.pinout_json,c.familia,c.genero,c.pin_positions_json,c.pin_colors_json,c.url,c.datasheet_path FROM nodos_lienzo n JOIN componentes_catalogo c ON c.id=n.componente_id WHERE proyecto_id=?',[id]);
  res.json({...project,hoja:JSON.parse(project.hoja_json||'{}'),distribucion:JSON.parse(project.distribucion_json||'{}'),nodes:nodes.map(n=>({...n,pinout:JSON.parse(n.pinout_json),pin_positions:JSON.parse(n.pin_positions_json||'{}'),pin_colors:JSON.parse(n.pin_colors_json||'{}')})),empalmes:await db.all('SELECT * FROM empalmes_lienzo WHERE proyecto_id=? ORDER BY id',[id]),cables:await db.all('SELECT * FROM cables WHERE proyecto_id=?',[id])});
}));
app.get('/api/proyectos/:id/versiones', asyncRoute(async (req,res) => {
  const projectId=Number(req.params.id);if(!await db.get('SELECT id FROM proyectos WHERE id=?',[projectId]))return res.status(404).json({error:'Proyecto no encontrado.'});
  await ensureProjectBaseline(projectId,req.user.id);
  const rows=await db.all('SELECT * FROM proyecto_versiones WHERE proyecto_id=? ORDER BY revision ASC',[projectId]);
  let chainValid=true;
  const versions=rows.map((row,index)=>{const valid=row.hash_anterior===(index?rows[index-1].hash:'0'.repeat(64))&&calculateVersionHash(row)===row.hash;if(!valid)chainValid=false;return {id:row.id,revision:row.revision,parent_revision:row.parent_revision,actor_id:row.actor_id,actor_nombre:row.actor_nombre,accion:row.accion,motivo:row.motivo,cambios:parseJson(row.cambios_json,[]),hash:row.hash,creado_en:row.creado_en,integridad:valid?'válida':'alterada'};});
  res.json({versions:versions.reverse(),integridad:chainValid?'válida':'alterada'});
}));
app.post('/api/proyectos/:id/versiones/:revision/restaurar', asyncRoute(async (req,res) => {
  const projectId=Number(req.params.id),targetRevision=Number(req.params.revision),reason=String(req.body?.motivo||'').trim();
  if(req.user.rol==='visor')return res.status(403).json({error:'El perfil de solo lectura no puede restaurar versiones.'});
  if(!Number.isInteger(targetRevision)||targetRevision<1)return res.status(400).json({error:'La revisión seleccionada no es válida.'});
  if(reason.length<5)return res.status(400).json({error:'Escribe un motivo de restauración de al menos 5 caracteres.'});
  const chain=await db.all('SELECT * FROM proyecto_versiones WHERE proyecto_id=? ORDER BY revision ASC',[projectId]);
  let previousHash='0'.repeat(64);
  for(const version of chain){if(version.hash_anterior!==previousHash||calculateVersionHash(version)!==version.hash)return res.status(409).json({error:'El historial no superó la verificación de integridad; no se restauró ningún dato.'});previousHash=version.hash;}
  const target=chain.find(version=>Number(version.revision)===targetRevision);
  if(!target)return res.status(404).json({error:'No se encontró esa revisión.'});
  const snapshot=parseJson(target.snapshot_json,null);if(!snapshot)return res.status(409).json({error:'La instantánea guardada no se puede leer.'});
  const beforeSnapshot=await projectSnapshot(projectId);if(!beforeSnapshot)return res.status(404).json({error:'Proyecto no encontrado.'});
  try{await restoreProjectSnapshot(projectId,snapshot);}catch(error){return res.status(409).json({error:error.message||'No se pudo restaurar la versión.'});}
  const version=await record(projectId,req.user.id,`Restauró R${String(targetRevision).padStart(6,'0')}`,{beforeSnapshot,reason,parentRevision:targetRevision});
  io.to(`project:${projectId}`).emit('project:restored',{projectId,revision:version.revision,restoredRevision:targetRevision});
  res.json({ok:true,revision:version.revision,restoredRevision:targetRevision});
}));
app.post('/api/proyectos/:id/empalmes', asyncRoute(async (req,res)=>{const projectId=Number(req.params.id),{nombre='CRIMP',x=240,y=180,color='#4388d1'}=req.body||{};if(!await db.get('SELECT id FROM proyectos WHERE id=?',[projectId]))return res.status(404).json({error:'Proyecto no encontrado.'});if(!Number.isFinite(Number(x))||!Number.isFinite(Number(y)))return res.status(400).json({error:'La posición del crimp no es válida.'});const beforeSnapshot=await projectSnapshot(projectId);const result=await db.run('INSERT INTO empalmes_lienzo(proyecto_id,nombre,pos_x,pos_y,color) VALUES(?,?,?,?,?)',[projectId,String(nombre).trim()||'CRIMP',Number(x),Number(y),String(color)]);const empalme=await db.get('SELECT * FROM empalmes_lienzo WHERE id=?',[result.lastID]);await record(projectId,req.user.id,`Crimp ${empalme.nombre} añadido`,{beforeSnapshot});io.to(`project:${projectId}`).emit('splice:created',empalme);res.status(201).json(empalme)}));
app.patch('/api/proyectos/:id/empalmes/:spliceId', asyncRoute(async (req,res)=>{const projectId=Number(req.params.id),id=Number(req.params.spliceId),{nombre,x,y,color}=req.body||{};const current=await db.get('SELECT * FROM empalmes_lienzo WHERE id=? AND proyecto_id=?',[id,projectId]);if(!current)return res.status(404).json({error:'Crimp no encontrado.'});const beforeSnapshot=await projectSnapshot(projectId);await db.run('UPDATE empalmes_lienzo SET nombre=?,pos_x=?,pos_y=?,color=? WHERE id=?',[String(nombre??current.nombre).trim()||current.nombre,Number.isFinite(Number(x))?Number(x):current.pos_x,Number.isFinite(Number(y))?Number(y):current.pos_y,String(color??current.color),id]);const item=await db.get('SELECT * FROM empalmes_lienzo WHERE id=?',[id]);await record(projectId,req.user.id,`Crimp ${id} actualizado`,{beforeSnapshot});io.to(`project:${projectId}`).emit('splice:updated',item);res.json(item)}));
app.delete('/api/proyectos/:id/empalmes/:spliceId', asyncRoute(async (req,res)=>{const projectId=Number(req.params.id),id=Number(req.params.spliceId),key=`splice-${id}`;const item=await db.get('SELECT id FROM empalmes_lienzo WHERE id=? AND proyecto_id=?',[id,projectId]);if(!item)return res.status(404).json({error:'Crimp no encontrado.'});const beforeSnapshot=await projectSnapshot(projectId);await db.run('DELETE FROM cables WHERE proyecto_id=? AND (pin_origen_id LIKE ? OR pin_destino_id LIKE ?)',[projectId,`${key}:%`,`${key}:%`]);await db.run('DELETE FROM empalmes_lienzo WHERE id=?',[id]);await record(projectId,req.user.id,`Crimp ${id} eliminado junto con sus conexiones`,{beforeSnapshot});io.to(`project:${projectId}`).emit('splice:deleted',{id});res.json({ok:true,id})}));
app.patch('/api/proyectos/:id/distribucion', asyncRoute(async (req,res) => {
  const id=Number(req.params.id), {distribucion}=req.body||{};
  if(!distribucion||typeof distribucion!=='object'||Array.isArray(distribucion))return res.status(400).json({error:'La distribución debe ser un objeto por conector y pin.'});
  const beforeSnapshot=await projectSnapshot(id);
  const result=await db.run('UPDATE proyectos SET distribucion_json=? WHERE id=?',[JSON.stringify(distribucion),id]);
  if(!result.changes)return res.status(404).json({error:'Proyecto no encontrado.'});
  await record(id,req.user.id,'Tabla de distribución actualizada',{beforeSnapshot});
  io.to(`project:${id}`).emit('distribution:updated',{projectId:id,distribucion});
  res.json({projectId:id,distribucion});
}));
app.patch('/api/proyectos/:id/hoja', asyncRoute(async (req,res) => {
  const id=Number(req.params.id), {hoja}=req.body||{};
  if(!hoja||typeof hoja!=='object'||Array.isArray(hoja))return res.status(400).json({error:'La configuración de la hoja debe ser un objeto.'});
  const beforeSnapshot=await projectSnapshot(id);
  const result=await db.run('UPDATE proyectos SET hoja_json=? WHERE id=?',[JSON.stringify(hoja),id]);
  if(!result.changes)return res.status(404).json({error:'Proyecto no encontrado.'});
  await record(id,req.user.id,'Configuración de hoja actualizada',{beforeSnapshot});
  const payload={projectId:id,hoja};io.to(`project:${id}`).emit('sheet:updated',payload);res.json(payload);
}));
// Aplica una escena declarativa desde JSON: se puede escribir un arnés por código o dibujarlo.
app.put('/api/proyectos/:id/escena', asyncRoute(async (req,res) => {
  const projectId=Number(req.params.id), {connectors,wires,splices=[],removeConnectorIds=[],removeWireIds=[],removeSpliceIds=[],distribution}=req.body||{};
  if(!await db.get('SELECT id FROM proyectos WHERE id=?',[projectId]))return res.status(404).json({error:'Proyecto no encontrado.'});
  const beforeSnapshot=await projectSnapshot(projectId);
  if(!Array.isArray(connectors)||!Array.isArray(wires)||!Array.isArray(splices)||!Array.isArray(removeConnectorIds)||!Array.isArray(removeWireIds)||!Array.isArray(removeSpliceIds)||(distribution!==undefined&&(!distribution||typeof distribution!=='object'||Array.isArray(distribution))))return res.status(400).json({error:'La escena requiere listas connectors, splices y wires válidas; distribution debe ser un objeto.'});
  const nodeMap=new Map();
  try {
    await db.exec('BEGIN IMMEDIATE');
    for(let i=0;i<connectors.length;i++){
      const item=connectors[i],key=String(item.id??`nuevo-${i}`),x=Number(item.x),y=Number(item.y);
      if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error(`Posición inválida para el conector ${key}.`);
      const existing=/^\d+$/.test(key)?await db.get('SELECT * FROM nodos_lienzo WHERE id=? AND proyecto_id=?',[Number(key),projectId]):null;
      const componentId=existing?.componente_id??Number(item.componentId);
      const component=await db.get('SELECT id,pin_count FROM componentes_catalogo WHERE id=?',[componentId]);
      if(!component)throw new Error(`Componente de biblioteca inválido para ${key}.`);
      if(existing?.bloqueado&&(existing.pos_x!==x||existing.pos_y!==y))throw new Error(`El conector ${key} está bloqueado; desbloquéalo antes de moverlo desde el código.`);
      const nodeId=existing?Number(existing.id):(await db.run('INSERT INTO nodos_lienzo(proyecto_id,componente_id,pos_x,pos_y) VALUES(?,?,?,?)',[projectId,componentId,x,y])).lastID;
      if(existing)await db.run('UPDATE nodos_lienzo SET pos_x=?,pos_y=? WHERE id=?',[x,y,nodeId]);
      nodeMap.set(key,{id:Number(nodeId),pinCount:Number(component.pin_count)});
    }
    for(let i=0;i<splices.length;i++){
      const item=splices[i],key=String(item.id??`crimp-nuevo-${i}`),x=Number(item.x),y=Number(item.y);
      if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error(`Posición inválida para el crimp ${key}.`);
      const existing=/^splice-(\d+)$/.exec(key),current=existing?await db.get('SELECT * FROM empalmes_lienzo WHERE id=? AND proyecto_id=?',[Number(existing[1]),projectId]):null;
      const spliceId=current?Number(current.id):(await db.run('INSERT INTO empalmes_lienzo(proyecto_id,nombre,pos_x,pos_y,color) VALUES(?,?,?,?,?)',[projectId,String(item.name||'CRIMP'),x,y,String(item.color||'#4388d1')])).lastID;
      if(current)await db.run('UPDATE empalmes_lienzo SET nombre=?,pos_x=?,pos_y=?,color=? WHERE id=?',[String(item.name||current.nombre),x,y,String(item.color||current.color),spliceId]);
      nodeMap.set(key,{id:`splice-${spliceId}`,pinCount:1,isSplice:true});
    }
    for(let i=0;i<wires.length;i++){
      const wire=wires[i],from=nodeMap.get(String(wire.from)),to=nodeMap.get(String(wire.to)),fromPin=Number(wire.fromPin),toPin=Number(wire.toPin);
      if(!from||!to||!Number.isInteger(fromPin)||!Number.isInteger(toPin)||fromPin<1||fromPin>from.pinCount||toPin<1||toPin>to.pinCount)throw new Error(`La conexión ${wire.id??i} apunta a un pin inexistente.`);
      const source=`${from.id}:${fromPin}`,target=`${to.id}:${toPin}`,fields=[String(wire.gauge||'18 AWG'),String(wire.color||'#38bdf8'),String(wire.material||'Cobre'),String(wire.label||''),Number.isFinite(Number(wire.length_mm))?Number(wire.length_mm):null,String(wire.bundle||''),String(wire.bundle_color||'#59636a')];
      const existing=/^\d+$/.test(String(wire.id))?await db.get('SELECT id FROM cables WHERE id=? AND proyecto_id=?',[Number(wire.id),projectId]):null;
      if(existing)await db.run('UPDATE cables SET pin_origen_id=?,pin_destino_id=?,calibre=?,color=?,material=?,etiqueta=?,longitud_mm=?,grupo_cable=?,color_funda=? WHERE id=?',[source,target,...fields,existing.id]);
      else await db.run('INSERT INTO cables(proyecto_id,pin_origen_id,pin_destino_id,calibre,color,material,etiqueta,longitud_mm,grupo_cable,color_funda) VALUES(?,?,?,?,?,?,?,?,?,?)',[projectId,source,target,...fields]);
    }
    for(const id of removeWireIds){if(!/^\d+$/.test(String(id)))throw new Error(`Identificador de cable inválido: ${id}.`);await db.run('DELETE FROM cables WHERE id=? AND proyecto_id=?',[Number(id),projectId]);}
    for(const id of removeSpliceIds){const match=/^splice-(\d+)$/.exec(String(id));if(!match)throw new Error(`Identificador de crimp inválido: ${id}.`);await db.run('DELETE FROM cables WHERE proyecto_id=? AND (pin_origen_id LIKE ? OR pin_destino_id LIKE ?)',[projectId,`${id}:%`,`${id}:%`]);await db.run('DELETE FROM empalmes_lienzo WHERE id=? AND proyecto_id=?',[Number(match[1]),projectId]);}
    for(const id of removeConnectorIds){if(!/^\d+$/.test(String(id)))throw new Error(`Identificador de conector inválido: ${id}.`);const node=await db.get('SELECT id,bloqueado FROM nodos_lienzo WHERE id=? AND proyecto_id=?',[Number(id),projectId]);if(node?.bloqueado)throw new Error(`El conector ${id} está bloqueado; desbloquéalo antes de quitarlo.`);if(node){await db.run('DELETE FROM cables WHERE proyecto_id=? AND (pin_origen_id LIKE ? OR pin_destino_id LIKE ?)',[projectId,`${id}:%`,`${id}:%`]);await db.run('DELETE FROM nodos_lienzo WHERE id=? AND proyecto_id=?',[Number(id),projectId]);}}
    if(distribution!==undefined)await db.run('UPDATE proyectos SET distribucion_json=? WHERE id=?',[JSON.stringify(distribution),projectId]);
    await db.exec('COMMIT');
  } catch(error) { await db.exec('ROLLBACK'); return res.status(400).json({error:error.message||'No se pudo aplicar la escena.'}); }
  await record(projectId,req.user.id,'Escena de arnés actualizada desde especificación JSON',{beforeSnapshot});
  io.to(`project:${projectId}`).emit('scene:updated',{projectId});
  if(distribution!==undefined)io.to(`project:${projectId}`).emit('distribution:updated',{projectId,distribucion:distribution});
  res.json({ok:true,connectors:connectors.length,splices:splices.length,wires:wires.length});
}));
// Importa un proyecto completo como subensamble conservando sus cables y propiedades.
app.post('/api/proyectos/:id/importar', asyncRoute(async (req,res) => {
  const destino = Number(req.params.id), origen = Number(req.body.origen_id);
  if (!Number.isInteger(destino) || !Number.isInteger(origen) || destino === origen) return res.status(400).json({error:'Selecciona dos proyectos diferentes.'});
  const [proyectoDestino, proyectoOrigen] = await Promise.all([db.get('SELECT id FROM proyectos WHERE id=?',[destino]),db.get('SELECT id FROM proyectos WHERE id=?',[origen])]);
  if (!proyectoDestino || !proyectoOrigen) return res.status(404).json({error:'No se encontró uno de los proyectos.'});
  const beforeSnapshot=await projectSnapshot(destino);
  const grupo = `ensamble-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const nodes = await db.all('SELECT * FROM nodos_lienzo WHERE proyecto_id=? ORDER BY id',[origen]);
  const existingNodes = await db.all('SELECT pos_x,pos_y FROM nodos_lienzo WHERE proyecto_id=?',[destino]);
  const map = new Map();
  const sourceMinX = nodes.length ? Math.min(...nodes.map(node => Number(node.pos_x))) : 0;
  const sourceMinY = nodes.length ? Math.min(...nodes.map(node => Number(node.pos_y))) : 0;
  const destinationMaxX = existingNodes.length ? Math.max(...existingNodes.map(node => Number(node.pos_x))) : null;
  const destinationMinY = existingNodes.length ? Math.min(...existingNodes.map(node => Number(node.pos_y))) : null;
  // Cada importación ocupa una nueva columna a la derecha, dejando sitio a las huellas y sus cables.
  const offsetX = destinationMaxX === null ? 80 - sourceMinX : destinationMaxX - sourceMinX + 900;
  const offsetY = destinationMinY === null ? 80 - sourceMinY : destinationMinY - sourceMinY;
  for (const n of nodes) {
    const result = await db.run('INSERT INTO nodos_lienzo(proyecto_id,componente_id,pos_x,pos_y,grupo_id,bloqueado) VALUES(?,?,?,?,?,0)',[destino,n.componente_id,n.pos_x+offsetX,n.pos_y+offsetY,grupo]);
    map.set(String(n.id),String(result.lastID));
  }
  const cables = await db.all('SELECT * FROM cables WHERE proyecto_id=?',[origen]);
  for (const c of cables) {
    const [from,fromPin] = c.pin_origen_id.split(':'), [to,toPin] = c.pin_destino_id.split(':');
    if (!map.has(from) || !map.has(to)) continue;
    await db.run('INSERT INTO cables(proyecto_id,pin_origen_id,pin_destino_id,calibre,color,material,etiqueta,grupo_cable,color_funda) VALUES(?,?,?,?,?,?,?,?,?)',[destino,`${map.get(from)}:${fromPin}`,`${map.get(to)}:${toPin}`,c.calibre,c.color,c.material,c.etiqueta,c.grupo_cable||'',c.color_funda||'#59636a']);
  }
  await record(destino,req.user.id,`Subensamble importado desde proyecto ${origen}`,{beforeSnapshot});
  const created = await db.all('SELECT id FROM nodos_lienzo WHERE proyecto_id=? AND grupo_id=?',[destino,grupo]);
  const payload = {grupo_id:grupo,node_ids:created.map(n=>String(n.id))};
  io.to(`project:${destino}`).emit('assembly:imported',payload);
  res.status(201).json(payload);
}));
app.patch('/api/proyectos/:id/grupos/:grupo', asyncRoute(async (req,res) => {
  const proyectoId=Number(req.params.id), grupo=req.params.grupo;
  const {accion,x=0,y=0}=req.body;
  const nodes=await db.all('SELECT id,pos_x,pos_y,bloqueado FROM nodos_lienzo WHERE proyecto_id=? AND grupo_id=?',[proyectoId,grupo]);
  if(!nodes.length)return res.status(404).json({error:'Subensamble no encontrado.'});
  const beforeSnapshot=await projectSnapshot(proyectoId);
  if(accion==='bloquear'||accion==='desbloquear') await db.run('UPDATE nodos_lienzo SET bloqueado=? WHERE proyecto_id=? AND grupo_id=?',[accion==='bloquear'?1:0,proyectoId,grupo]);
  else if(accion==='mover') {
    if(!Number.isFinite(x)||!Number.isFinite(y))return res.status(400).json({error:'Desplazamiento inválido.'});
    for(const n of nodes) if(!n.bloqueado) await db.run('UPDATE nodos_lienzo SET pos_x=?,pos_y=? WHERE id=?',[n.pos_x+x,n.pos_y+y,n.id]);
    const changes=nodes.filter(n=>!n.bloqueado).map(n=>({nodeId:n.id,x:n.pos_x+x,y:n.pos_y+y}));
    io.to(`project:${proyectoId}`).emit('assembly:moved',{grupo_id:grupo,changes});
  } else return res.status(400).json({error:'Acción de grupo no válida.'});
  await record(proyectoId,req.user.id,accion==='mover'?`Subensamble ${grupo} movido ${x}, ${y}`:`Subensamble ${grupo} ${accion}`,{beforeSnapshot});
  res.json({grupo_id:grupo,bloqueado:accion==='bloquear'});
}));
app.delete('/api/proyectos/:id/nodos/:nodeId', asyncRoute(async (req,res) => {
  const projectId=Number(req.params.id),nodeId=Number(req.params.nodeId);
  const node=await db.get('SELECT id FROM nodos_lienzo WHERE id=? AND proyecto_id=?',[nodeId,projectId]);
  if(!node)return res.status(404).json({error:'El conector ya no existe en este arnés.'});
  const beforeSnapshot=await projectSnapshot(projectId);
  await db.run('DELETE FROM cables WHERE proyecto_id=? AND (pin_origen_id LIKE ? OR pin_destino_id LIKE ?)',[projectId,`${nodeId}:%`,`${nodeId}:%`]);
  await db.run('DELETE FROM nodos_lienzo WHERE id=? AND proyecto_id=?',[nodeId,projectId]);
  await record(projectId,req.user.id,`Conector ${nodeId} eliminado junto con sus conexiones`,{beforeSnapshot});
  res.json({ok:true,nodeId});
}));
app.patch('/api/proyectos/:id/nodos/:nodeId/huella', asyncRoute(async (req,res) => {
  const projectId=Number(req.params.id),nodeId=Number(req.params.nodeId),{x,y}=req.body;
  if(!Number.isFinite(x)||!Number.isFinite(y))return res.status(400).json({error:'Posición de huella inválida.'});
  const beforeSnapshot=await projectSnapshot(projectId);
  const result=await db.run('UPDATE nodos_lienzo SET huella_x=?,huella_y=? WHERE id=? AND proyecto_id=?',[x,y,nodeId,projectId]);
  if(!result.changes)return res.status(404).json({error:'No se encontró el conector en este arnés.'});
  await record(projectId,req.user.id,`Huella del conector ${nodeId} movida a X ${x}, Y ${y}`,{beforeSnapshot});
  const payload={projectId,nodeId,x,y};io.to(`project:${projectId}`).emit('footprint:moved',payload);res.json(payload);
}));
app.patch('/api/proyectos/:id/nodos/:nodeId/bloqueo', asyncRoute(async (req,res) => {
  const projectId=Number(req.params.id),nodeId=Number(req.params.nodeId),bloqueado=!!req.body.bloqueado;
  const beforeSnapshot=await projectSnapshot(projectId);
  const result=await db.run('UPDATE nodos_lienzo SET bloqueado=? WHERE id=? AND proyecto_id=?',[bloqueado?1:0,nodeId,projectId]);
  if(!result.changes)return res.status(404).json({error:'No se encontró el conector en este arnés.'});
  await record(projectId,req.user.id,`Conector ${nodeId} ${bloqueado?'bloqueado':'desbloqueado'}`,{beforeSnapshot});
  io.to(`project:${projectId}`).emit('node:locked',{nodeId,bloqueado});
  res.json({nodeId,bloqueado});
}));
app.delete('/api/componentes/:id', asyncRoute(async (req,res) => {
  const id=Number(req.params.id), component=await db.get('SELECT id,nombre FROM componentes_catalogo WHERE id=?',[id]);
  if(!component)return res.status(404).json({error:'El conector ya no existe en la biblioteca.'});
  const used=await db.get('SELECT COUNT(*) AS n FROM nodos_lienzo WHERE componente_id=?',[id]);
  if(used.n)return res.status(409).json({error:`No se puede borrar «${component.nombre}»: está usado en ${used.n} posición(es) de arnés. Primero quítalo de esos proyectos.`});
  await db.run('DELETE FROM componentes_catalogo WHERE id=?',[id]);
  res.json({ok:true,id});
}));
app.patch('/api/proyectos/:id/estado', asyncRoute(async (req,res) => {
  const {estado} = req.body ?? {};
  if (!['No empezado','En progreso','Terminado'].includes(estado)) return res.status(400).json({error:'Estado inválido.'});
  const id = Number(req.params.id);
  const beforeSnapshot=await projectSnapshot(id);
  const result = await db.run('UPDATE proyectos SET estado=? WHERE id=?',[estado,id]);
  if (!result.changes) return res.status(404).json({error:'Proyecto no encontrado.'});
  await record(id,req.user.id,`Estado cambiado a ${estado}`,{beforeSnapshot});
  const project = await db.get('SELECT * FROM proyectos WHERE id=?',[id]);
  io.emit('project:updated',project);
  res.json(project);
}));
app.use((error,_req,res,_next) => {
  console.error('Error en la API:',error);
  // En esta aplicación local devolvemos un detalle breve para facilitar el diagnóstico al usuario.
  if (!res.headersSent) res.status(500).json({error:'El servidor no pudo completar la operación.',detalle:error.message||'Error interno sin detalle.'});
});

io.use((socket,next)=>{sessionUser(socket.handshake.auth?.token).then(user=>{if(!user)return next(new Error('Sesión requerida.'));socket.data.user=user;next()}).catch(()=>next(new Error('Sesión no válida.')))});
const projectPresence = projectId => {
  const room = io.sockets.adapter.rooms.get(`project:${projectId}`) || new Set();
  const users = new Map();
  for (const socketId of room) {
    const peer = io.sockets.sockets.get(socketId);
    if (peer?.data?.user) users.set(peer.data.user.id, peer.data.user);
  }
  return [...users.values()];
};
io.on('connection', socket => {
  socket.on('network:ping',(_data,ack)=>ack?.({ok:true,time:Date.now()}));
  socket.on('project:join',id => {
    const projectId = Number(id);
    if (!Number.isInteger(projectId) || projectId < 1) return;
    const previous = socket.data.projectId;
    if (previous && previous !== projectId) {
      socket.leave(`project:${previous}`);
      socket.to(`project:${previous}`).emit('presence:update', projectPresence(previous));
    }
    socket.data.projectId = projectId;
    socket.join(`project:${projectId}`);
    io.to(`project:${projectId}`).emit('presence:update', projectPresence(projectId));
  });
  socket.on('project:leave',id => {
    const projectId = Number(id);
    if (!Number.isInteger(projectId) || socket.data.projectId !== projectId) return;
    socket.leave(`project:${projectId}`);
    socket.data.projectId = null;
    socket.to(`project:${projectId}`).emit('presence:update', projectPresence(projectId));
  });
  socket.on('presence:cursor',data => socket.to(`project:${Number(data.projectId)}`).emit('presence:cursor',{...data,socketId:socket.id}));
  socket.on('node:move',(data,ack) => {
    const {projectId,nodeId,x,y}=data;
    if (![projectId,nodeId,x,y].every(Number.isFinite)){ack?.({ok:false,error:'Posición inválida'});return;}
    void (async()=>{try{const node=await db.get('SELECT grupo_id,bloqueado FROM nodos_lienzo WHERE id=? AND proyecto_id=?',[nodeId,projectId]);if(!node||node.bloqueado){ack?.({ok:false,error:'Conector inexistente o bloqueado'});return;}const beforeSnapshot=await projectSnapshot(projectId);await db.run('UPDATE nodos_lienzo SET pos_x=?,pos_y=? WHERE id=? AND proyecto_id=?',[x,y,nodeId,projectId]);await record(projectId,socket.data.user.id,`Conector ${nodeId} movido a X ${x}, Y ${y}`,{beforeSnapshot});socket.to(`project:${projectId}`).emit('node:moved',data);ack?.({ok:true});}catch(e){console.error('Error moviendo nodo:',e);ack?.({ok:false,error:e.message});}})();
  });
  socket.on('node:create',data => {
    const {projectId,componenteId,x=100,y=100}=data;
    if (![projectId,componenteId,x,y].every(Number.isFinite)) return;
    void (async()=>{try{const beforeSnapshot=await projectSnapshot(projectId);const result=await db.run('INSERT INTO nodos_lienzo(proyecto_id,componente_id,pos_x,pos_y) VALUES(?,?,?,?)',[projectId,componenteId,x,y]);const node=await db.get('SELECT n.*,c.nombre componente_nombre,c.modelo,c.tipo,c.pinout_json,c.familia,c.genero,c.pin_positions_json,c.pin_colors_json FROM nodos_lienzo n JOIN componentes_catalogo c ON c.id=n.componente_id WHERE n.id=?',[result.lastID]);if(!node)return;const payload={...node,pinout:JSON.parse(node.pinout_json),pin_positions:JSON.parse(node.pin_positions_json||'{}'),pin_colors:JSON.parse(node.pin_colors_json||'{}')};await record(projectId,socket.data.user.id,`Componente ${node.componente_nombre} añadido`,{beforeSnapshot});io.to(`project:${projectId}`).emit('node:created',payload);}catch(e){console.error('Error creando nodo:',e);}})();
  });
  socket.on('cable:create',(data,ack) => {
    const {projectId,source,target,calibre='18 AWG',color='#38bdf8',material='Cobre',etiqueta='',longitud_mm=null,grupo_cable='',color_funda='#59636a'}=data;
    if (!Number.isFinite(projectId)||!source||!target){ack?.({ok:false,error:'Conexión inválida'});return;}
    void (async()=>{try{const beforeSnapshot=await projectSnapshot(projectId);const result=await db.run('INSERT INTO cables(proyecto_id,pin_origen_id,pin_destino_id,calibre,color,material,etiqueta,longitud_mm,grupo_cable,color_funda) VALUES(?,?,?,?,?,?,?,?,?,?)',[projectId,source,target,calibre,color,material,etiqueta,longitud_mm,grupo_cable,color_funda]);const cable=await db.get('SELECT * FROM cables WHERE id=?',[result.lastID]);await record(projectId,socket.data.user.id,`Cable ${source} → ${target} creado`,{beforeSnapshot});io.to(`project:${projectId}`).emit('cable:created',cable);ack?.({ok:true,id:cable.id});}catch(e){console.error('Error creando cable:',e);ack?.({ok:false,error:e.message});}})();
  });
  socket.on('cable:update',(data,ack) => {
    const {projectId,id,calibre,color,material,etiqueta,longitud_mm,grupo_cable,color_funda,pin_origen_id,pin_destino_id}=data;
    if (![projectId,id].every(Number.isFinite)){ack?.({ok:false,error:'Cable inválido'});return;}
    void (async()=>{try{const beforeSnapshot=await projectSnapshot(projectId);const hasLongitud=Object.hasOwn(data,'longitud_mm');await db.run('UPDATE cables SET calibre=COALESCE(?,calibre),color=COALESCE(?,color),material=COALESCE(?,material),etiqueta=COALESCE(?,etiqueta),grupo_cable=COALESCE(?,grupo_cable),color_funda=COALESCE(?,color_funda),longitud_mm=CASE WHEN ?=1 THEN ? ELSE longitud_mm END,pin_origen_id=COALESCE(?,pin_origen_id),pin_destino_id=COALESCE(?,pin_destino_id) WHERE id=? AND proyecto_id=?',[calibre,color,material,etiqueta,grupo_cable,color_funda,hasLongitud?1:0,longitud_mm,pin_origen_id,pin_destino_id,id,projectId]);const cable=await db.get('SELECT * FROM cables WHERE id=?',[id]);if(cable){await record(projectId,socket.data.user.id,`Cable ${id} actualizado`,{beforeSnapshot});io.to(`project:${projectId}`).emit('cable:updated',cable);ack?.({ok:true});}else ack?.({ok:false,error:'Cable no encontrado'});}catch(e){console.error('Error actualizando cable:',e);ack?.({ok:false,error:e.message});}})();
  });
  socket.on('disconnect',() => { if(socket.data.projectId){const projectId=socket.data.projectId;socket.to(`project:${projectId}`).emit('presence:left',{socketId:socket.id});socket.to(`project:${projectId}`).emit('presence:update',projectPresence(projectId));} });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT,'0.0.0.0',()=>console.log(`Servidor de arneses listo en http://0.0.0.0:${PORT}`));
