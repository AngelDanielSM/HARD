import { useState } from 'react';
import axios from 'axios';
import { Camera, Check, Palette, UserRound, X } from 'lucide-react';
import { useEscape } from '../hooks/useEscape.js';

const api=axios.create({baseURL:'/api'});
api.interceptors.request.use(config=>{const token=localStorage.getItem('harness-token')||sessionStorage.getItem('harness-token')||'';if(token)config.headers.Authorization=`Bearer ${token}`;return config});
const colors=['#38bdf8','#a78bfa','#34d399','#fb7185','#f59e0b','#64748b','#e879f9','#22c55e'];

export default function ProfileDialog({profile,admin=false,isSelf=true,onClose,onSaved}) {
  const [nombre,setNombre]=useState(profile.nombre||'');
  const [rol,setRol]=useState(profile.rol||'ensamblador');
  const [color,setColor]=useState(profile.color_avatar||'#38bdf8');
  const [avatar,setAvatar]=useState(profile.avatar_data||null);
  const [currentPassword,setCurrentPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEscape(onClose,true);
  const readImage=event=>{
    const file=event.target.files?.[0];if(!file)return;
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>1024*1024){setError('Elige PNG, JPG, WEBP o GIF de hasta 1 MB.');event.target.value='';return}
    const reader=new FileReader();reader.onload=()=>{setAvatar(String(reader.result));setError('')};reader.onerror=()=>setError('No se pudo leer la imagen.');reader.readAsDataURL(file);
  };
  const save=async event=>{
    event.preventDefault();setBusy(true);setError('');
    try{
      const payload={nombre:nombre.trim(),color_avatar:color,avatar_data:avatar};
      if(admin)payload.rol=rol;
      if(newPassword)payload.new_password=newPassword;
      if(isSelf&&currentPassword)payload.current_password=currentPassword;
      const{data}=await api.patch(`/usuarios/${profile.id}`,payload);onSaved(data);onClose();
    }catch(e){setError(e.response?.data?.error||'No se pudo guardar el perfil.')}finally{setBusy(false)}
  };
  const initials=nombre.trim().split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase()||'?';
  return <div className="modal-backdrop profile-backdrop" onMouseDown={event=>event.target===event.currentTarget&&onClose()}>
    <form className="profile-dialog" onSubmit={save}>
      <header className="modal-head"><div><div className="eyebrow">CUENTA Y PREFERENCIAS</div><h2>{isSelf?'Mi perfil':`Editar a ${profile.nombre}`}</h2></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={17}/></button></header>
      <div className="profile-picture-row"><div className="profile-picture-preview" style={{background:color}}>{avatar?<img src={avatar} alt="Vista previa del perfil"/>:initials}</div><label className="btn-quiet profile-upload"><Camera size={14}/> Cambiar imagen<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={readImage}/></label>{avatar&&<button type="button" className="text-button profile-remove-image" onClick={()=>setAvatar(null)}>Quitar imagen</button>}</div>
      <label className="field-label">Nombre visible</label><input required maxLength={80} autoFocus value={nombre} onChange={event=>setNombre(event.target.value)} placeholder="Nombre del perfil"/>
      <label className="field-label"><Palette size={13}/> Color del perfil</label><div className="profile-color-options">{colors.map(item=><button key={item} type="button" aria-label={`Usar color ${item}`} title={item} className={color===item?'selected':''} style={{'--profile-color':item}} onClick={()=>setColor(item)}/>)}</div><div className="profile-custom-color"><input type="color" aria-label="Color personalizado" value={color} onChange={event=>setColor(event.target.value)}/><span>{color.toUpperCase()}</span></div>
      {admin&&<><label className="field-label"><UserRound size={13}/> Rol y permisos</label><select value={rol} onChange={event=>setRol(event.target.value)}><option value="admin">Administrador</option><option value="ensamblador">Ensamblador</option><option value="visor">Visor</option></select></>}
      {isSelf&&<><label className="field-label">Contraseña actual</label><input type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)} placeholder="Requerida para cambiar contraseña"/></>}
      <label className="field-label">{isSelf?'Nueva contraseña (opcional)':'Restablecer contraseña (opcional)'}</label><input type="password" minLength={newPassword?10:undefined} maxLength={200} autoComplete="new-password" value={newPassword} onChange={event=>setNewPassword(event.target.value)} placeholder="Mínimo 10 caracteres"/>
      {error&&<p className="form-error">{error}</p>}
      <footer className="modal-actions"><button type="button" className="btn-quiet" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy}><Check size={14}/>{busy?'Guardando…':'Guardar perfil'}</button></footer>
    </form>
  </div>;
}
