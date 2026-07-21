import {MouseEvent,useState} from 'react'
import App from './App'
import ClientsModule from './ClientsModule'
import SipsModule from './SipsModule'
import AutomationsModule from './AutomationsModule'
import MarketFarmaModule from './MarketFarmaModule'
import HistoryModule from './HistoryModule'

type Page='home'|'clientes'|'oportunidades'|'sips'|'automacoes'|'mercado'|'historico'

export default function AppShell(){
 const [page,setPage]=useState<Page>('home')
 const go=(next:Page)=>{setPage(next);window.scrollTo({top:0,behavior:'smooth'})}
 function capture(event:MouseEvent<HTMLDivElement>){
  const target=event.target as HTMLElement,card=target.closest('.module-card') as HTMLElement|null,title=card?.querySelector('h3')?.textContent?.trim(),button=target.closest('button')?.textContent?.trim()||''
  const route:Record<string,Page>={'Clientes':'clientes','Oportunidades':'oportunidades','SIP / Redes':'sips','Automações':'automacoes','Mercado Farma':'mercado','Histórico':'historico'}
  const next=title?route[title]:button.includes('Central de automações')?'automacoes':undefined
  if(next){event.preventDefault();event.stopPropagation();go(next)}
 }
 if(page==='home')return <div onClickCapture={capture}><App/></div>
 let content
 if(page==='sips')content=<SipsModule onBack={()=>go('home')}/>
 else if(page==='automacoes')content=<AutomationsModule onBack={()=>go('home')}/>
 else if(page==='mercado')content=<MarketFarmaModule onBack={()=>go('home')} onAutomations={()=>go('automacoes')}/>
 else if(page==='historico')content=<HistoryModule onBack={()=>go('home')} onAutomations={()=>go('automacoes')}/>
 else content=<ClientsModule onBack={()=>go('home')}/>
 return <div className="app-shell"><header className="topbar"><button className="brand brand-button" type="button" onClick={()=>go('home')}><div className="brand-mark">N</div><div><strong>Painel Comercial</strong><span>Equipe Norte</span></div></button><div className="topbar-actions"><span className="environment-badge">Nova versão</span><button className="profile-button" type="button">MB</button></div></header>{content}<footer><span>Painel Comercial · Equipe Norte</span><span>{page==='oportunidades'?'Oportunidades comerciais':'Módulo ativo'}</span></footer></div>
}
