import { MouseEvent, useState } from 'react'
import App from './App'
import ClientsModule from './ClientsModule'
import SipsModule from './SipsModule'

type Page='home'|'clientes'|'oportunidades'|'sips'

export default function AppShell(){
 const [page,setPage]=useState<Page>('home')
 function capture(event:MouseEvent<HTMLDivElement>){
  const target=event.target as HTMLElement
  const card=target.closest('.module-card') as HTMLElement|null
  const title=card?.querySelector('h3')?.textContent?.trim()
  const route:Record<string,Page>={'Clientes':'clientes','Oportunidades':'oportunidades','SIP / Redes':'sips'}
  if(title&&route[title]){event.preventDefault();event.stopPropagation();setPage(route[title]);window.scrollTo({top:0,behavior:'smooth'})}
 }
 if(page==='home')return <div onClickCapture={capture}><App/></div>
 return <div className="app-shell"><header className="topbar"><button className="brand brand-button" type="button" onClick={()=>setPage('home')}><div className="brand-mark">N</div><div><strong>Painel Comercial</strong><span>Equipe Norte</span></div></button><div className="topbar-actions"><span className="environment-badge">Nova versão</span><button className="profile-button" type="button">MB</button></div></header>{page==='sips'?<SipsModule onBack={()=>setPage('home')}/>:<ClientsModule onBack={()=>setPage('home')}/>}<footer><span>Painel Comercial · Equipe Norte</span><span>{page==='oportunidades'?'Oportunidades comerciais':'Módulo ativo'}</span></footer></div>
}
