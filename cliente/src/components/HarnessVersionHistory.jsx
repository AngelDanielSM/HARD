import { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, CheckCircle2, Clock3, History, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useEscape } from '../hooks/useEscape.js';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use(config => {
  const token = localStorage.getItem('harness-token') || sessionStorage.getItem('harness-token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
const revisionLabel = value => `R${String(value).padStart(6, '0')}`;
const describe = change => {
  const prefix = `${change.elemento}${change.id ? ` ${change.id}` : ''}`;
  if (change.accion === 'añadido') return `${prefix} añadido`;
  if (change.accion === 'eliminado') return `${prefix} eliminado`;
  const fieldNames = { pos_x: 'posición X', pos_y: 'posición Y', color: 'color', calibre: 'calibre', etiqueta: 'señal', pin_origen_id: 'origen', pin_destino_id: 'destino', grupo_id: 'grupo', nombre: 'nombre', estado: 'estado' };
  const field = fieldNames[change.campo] || change.campo;
  return `${prefix}: ${field} · ${formatValue(change.antes)} → ${formatValue(change.despues)}`;
};
const formatValue = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);

export default function HarnessVersionHistory({ projectId, canEdit, onClose, onRestored }) {
  const [versions, setVersions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [integrity, setIntegrity] = useState('…');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  useEscape(onClose);
  useEffect(() => {
    let active = true;
    api.get(`/proyectos/${projectId}/versiones`).then(({ data }) => {
      if (!active) return;
      setVersions(data.versions || []);
      setSelected(data.versions?.[0] || null);
      setIntegrity(data.integridad || 'alterada');
    }).catch(e => { if (active) setError(e.response?.data?.error || 'No se pudo cargar el historial.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);
  const restore = async () => {
    if (!selected || reason.trim().length < 5) return;
    setBusy(true); setError('');
    try {
      await api.post(`/proyectos/${projectId}/versiones/${selected.revision}/restaurar`, { motivo: reason.trim() });
      onRestored?.();
    } catch (e) { setError(e.response?.data?.error || 'No se pudo restaurar la revisión.'); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop version-history-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <section className="version-history-modal" role="dialog" aria-modal="true" aria-labelledby="version-history-title">
      <header className="version-history-header"><div className="version-history-title"><span><History size={18}/></span><div><div className="eyebrow">TRAZABILIDAD DEL ARNÉS</div><h2 id="version-history-title">Historial de versiones</h2><small>{versions.length} revisiones guardadas · cada revisión conserva una instantánea completa</small></div></div><button className="icon-button" onClick={onClose} aria-label="Cerrar historial"><X size={17}/></button></header>
      <div className={`version-integrity ${integrity === 'válida' ? 'is-valid' : integrity === 'alterada' ? 'is-invalid' : ''}`}>{integrity === 'válida' ? <ShieldCheck size={15}/> : integrity === 'alterada' ? <AlertTriangle size={15}/> : <Clock3 size={15}/>} Cadena de integridad: <b>{integrity === 'válida' ? 'verificada' : integrity === 'alterada' ? 'hay cambios no válidos' : 'verificando'}</b><small>SHA-256 encadenado</small></div>
      {error && <div className="version-error" role="alert">{error}</div>}
      {loading ? <div className="version-loading">Cargando revisiones…</div> : <div className="version-history-body">
        <nav className="version-list" aria-label="Revisiones del arnés">{versions.map(version => <button key={version.revision} className={`version-row ${selected?.revision === version.revision ? 'is-selected' : ''}`} onClick={() => { setSelected(version); setReason(''); setError(''); }}><span className="version-number">{revisionLabel(version.revision)}</span><span className="version-row-content"><b>{version.accion}</b><small>{version.actor_nombre} · {new Date(version.creado_en).toLocaleString()}</small><small>{version.cambios?.length || 0} cambios {version.parent_revision ? `· deriva de ${revisionLabel(version.parent_revision)}` : ''}</small></span><span className={`version-mark ${version.integridad === 'válida' ? 'valid' : 'invalid'}`}>{version.integridad === 'válida' ? <CheckCircle2 size={15}/> : <AlertTriangle size={15}/>}</span></button>)}</nav>
        <article className="version-detail">{selected ? <><div className="version-detail-heading"><div><span className="eyebrow">REVISIÓN SELECCIONADA</span><h3>{revisionLabel(selected.revision)} · {selected.accion}</h3><p>{selected.actor_nombre} · {new Date(selected.creado_en).toLocaleString()}</p></div><span className="version-hash" title={selected.hash}>SHA-256 · {selected.hash?.slice(0, 16)}…</span></div><div className="version-reason"><b>Motivo</b><p>{selected.motivo || 'Sin motivo indicado.'}</p></div><div className="version-delta-heading"><b>Cambios registrados</b><span>{selected.cambios?.length || 0}</span></div><ul className="version-delta-list">{selected.cambios?.length ? selected.cambios.map((change, index) => <li key={`${change.elemento}-${change.id}-${change.campo}-${index}`}><span>{change.accion === 'eliminado' ? '−' : change.accion === 'añadido' ? '+' : '↔'}</span>{describe(change)}</li>) : <li className="version-no-delta">Línea base inicial: estado de referencia del proyecto.</li>}</ul></> : <div className="version-empty">Aún no hay revisiones.</div>}</article>
      </div>}
      <footer className="version-history-footer">{selected && canEdit && <div className="version-restore"><input aria-label="Motivo para restaurar" value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo obligatorio para restaurar…" maxLength={300}/><button className="btn-primary" disabled={busy || reason.trim().length < 5} onClick={restore}><RotateCcw size={14}/>{busy ? 'Restaurando…' : `Restaurar ${revisionLabel(selected.revision)}`}</button></div>}<button className="btn-quiet" onClick={onClose}>Cerrar</button></footer>
    </section>
  </div>;
}
