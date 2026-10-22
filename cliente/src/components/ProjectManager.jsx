import { useMemo, useState } from 'react';
import { Activity, Cable, Check, ChevronRight, Clock3, FolderKanban, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import axios from 'axios';
import { useEscape } from '../hooks/useEscape.js';
import ConfirmDialog from './ConfirmDialog.jsx';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use(config=>{const token=localStorage.getItem('harness-token')||sessionStorage.getItem('harness-token')||'';if(token)config.headers.Authorization=`Bearer ${token}`;return config});
const estados = ['No empezado', 'En progreso', 'Terminado'];

// Vista CRUD de proyectos; la edición de datos se realiza en un formulario compacto.
export default function ProjectManager({ projects, openProject, createProject, onProjectsChange, user, canEdit }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Todos');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({ nombre: '', descripcion: '', estado: 'No empezado' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmProject, setConfirmProject] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const filtered = useMemo(() => projects.filter(project =>
    (filter === 'Todos' || project.estado === filter) &&
    `${project.nombre} ${project.descripcion || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  ), [projects, filter, query]);
  const startEdit = project => { setEditing(project.id); setDraft({ nombre: project.nombre, descripcion: project.descripcion || '', estado: project.estado }); setError(''); };
  const save = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (creating) {
        const project = await createProject(draft.nombre, draft.descripcion);
        if (draft.estado !== 'No empezado') {
          const { data } = await api.patch(`/proyectos/${project.id}`, { ...draft, usuario_id: user.id });
          onProjectsChange(current => current.map(item => item.id === data.id ? data : item));
          openProject(data);
        } else openProject(project);
      } else {
        const { data } = await api.patch(`/proyectos/${editing}`, { ...draft, usuario_id: user.id });
        onProjectsChange(current => current.map(item => item.id === data.id ? data : item));
      }
      setEditing(null); setCreating(false);
    } catch (e) { setError(e.response?.data?.error || 'No se pudo guardar el proyecto.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirmProject || deleting) return;
    const project=confirmProject;setDeleting(true);setError('');
    try { await api.delete(`/proyectos/${project.id}`); onProjectsChange(current => current.filter(item => item.id !== project.id));setConfirmProject(null); }
    catch (e) { setError(e.response?.data?.error || 'No se pudo eliminar el proyecto.'); }
    finally {setDeleting(false)}
  };
  const startCreate = () => { setCreating(true); setEditing(null); setDraft({ nombre: '', descripcion: '', estado: 'No empezado' }); setError(''); };
  const cancel = () => { setEditing(null); setCreating(false); setError(''); };
  useEscape(cancel, !!(editing || creating));
  return <main className="workspace-main project-manager-page">
    <div className="workspace-welcome"><div><div className="eyebrow">ESPACIO DE TRABAJO / ADMINISTRACIÓN</div><h1>Gestión de proyectos</h1><p>Organiza tus arneses, actualiza sus datos y abre cualquier proyecto para continuar.</p></div><button className="btn-primary" disabled={!canEdit} title={!canEdit ? "El perfil visor no puede crear proyectos" : "Nuevo proyecto"} onClick={startCreate}><Plus size={15}/> Nuevo proyecto</button></div>
    <section className="project-manager-tools"><label className="project-search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nombre o descripción"/></label><select value={filter} onChange={event => setFilter(event.target.value)}><option>Todos</option>{estados.map(status => <option key={status}>{status}</option>)}</select><span>{filtered.length} de {projects.length} proyectos</span></section>
    {error && <p className="form-error">{error}</p>}
    {(editing || creating) && <div className="modal-backdrop project-edit-backdrop" onMouseDown={event => event.target === event.currentTarget && cancel()}><form className="project-edit-modal" onSubmit={save}><div className="modal-head"><div><div className="eyebrow">{creating ? 'NUEVO ARNÉS' : 'EDITAR DATOS'}</div><h2>{creating ? 'Crear proyecto' : 'Editar proyecto'}</h2></div><button type="button" className="icon-button" onClick={cancel}><X size={17}/></button></div><label className="field-label">Nombre del proyecto *</label><input required maxLength={120} autoFocus value={draft.nombre} onChange={event => setDraft(current => ({ ...current, nombre: event.target.value }))}/><label className="field-label">Descripción</label><textarea rows="3" maxLength={500} value={draft.descripcion} onChange={event => setDraft(current => ({ ...current, descripcion: event.target.value }))}/><label className="field-label">Estado</label><select value={draft.estado} onChange={event => setDraft(current => ({ ...current, estado: event.target.value }))}>{estados.map(status => <option key={status}>{status}</option>)}</select>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="btn-quiet" onClick={cancel}>Cancelar</button><button className="btn-primary" disabled={busy}><Check size={15}/>{busy ? 'Guardando…' : 'Guardar'}</button></div></form></div>}
    {filtered.length ? <div className="project-manager-list">{filtered.map(project => <article className="project-manager-card" key={project.id}><div className="project-manager-icon"><FolderKanban size={20}/></div><div className="project-manager-details"><div className="project-manager-title"><h2>{project.nombre}</h2><span className={`project-status ${project.estado === 'Terminado' ? 'status-done' : project.estado === 'En progreso' ? 'status-active' : 'status-idle'}`}><i/>{project.estado}</span></div><p>{project.descripcion || 'Sin descripción. Añade datos para identificar este arnés.'}</p><div className="project-manager-meta"><span><Clock3 size={12}/>{project.fecha_creacion ? new Date(project.fecha_creacion.replace(' ', 'T') + 'Z').toLocaleDateString() : 'Fecha no disponible'}</span><span><Activity size={12}/> Proyecto #{project.id}</span></div></div><div className="project-manager-actions"><button className="btn-primary" onClick={() => openProject(project)}>Abrir editor <ChevronRight size={15}/></button>{canEdit && <><button className="icon-button" title="Editar proyecto" onClick={() => startEdit(project)}><Pencil size={15}/></button><button className="icon-button danger-icon" title="Eliminar proyecto" onClick={() => setConfirmProject(project)}><Trash2 size={15}/></button></>}</div></article>)}</div> : <section className="project-empty"><Cable size={24}/><strong>{projects.length ? 'No hay resultados' : 'Aún no hay proyectos'}</strong><span>{projects.length ? 'Cambia la búsqueda o el filtro.' : 'Crea tu primer arnés para comenzar.'}</span>{!projects.length && canEdit && <button className="btn-primary" onClick={startCreate}><Plus size={15}/> Crear proyecto</button>}</section>}
    {confirmProject&&<ConfirmDialog title="Eliminar proyecto" message={`Se eliminará “${confirmProject.nombre}” junto con sus componentes, cables e historial. Esta acción no se puede deshacer.`} confirmLabel="Eliminar proyecto" busy={deleting} onCancel={()=>setConfirmProject(null)} onConfirm={remove}/>}
  </main>;
}
