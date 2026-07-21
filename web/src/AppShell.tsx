import { MouseEvent, useState } from 'react'
import App from './App'
import AutomationsModule from './AutomationsModule'
import ClientsModule from './ClientsModule'
import MarketFarmaModule from './MarketFarmaModule'
import OpportunitiesModule from './OpportunitiesModule'
import SipsModule from './SipsModule'

type Page='home'|'clientes'|'oportunidades'|'sips'|'mercado'|'automacoes'

export default function AppShell(){
 const [page,setPage]=useState<Page>('home')
 function capture(event:MouseEvent<HTMLDivElement>){
  const target=event.target as HTMLElement
  const card=target.closest('.module-card') as HTMLElement|null
  const title=card?.querySelector('h3')?.textContent?.trim()
  const route:Record<string,Page>={'Clientes':'clientes','Oportunidades':'oportunidades','SIP / Redes':'sips','Mercado Farma':'mercado','Automações':'automacoes'}
  if(title&&route[title]){event.preventDefault();event.stopPropagation();setPage(route[title]);window.scrollTo({top:0,behavior:'smooth'})}
 }
 if(page==='home')return <div onClickCapture={capture}><App/></div>
 const voltar=()=>setPage('home')
 let modulo=<ClientsModule onBack={voltar}/>
 if(page==='oportunidades')modulo=<OpportunitiesModule onBack={voltar}/>
 if(page==='sips')modulo=<SipsModule onBack={voltar}/>
 if(page==='mercado')modulo=<MarketFarmaModule onBack={voltar}/>
 if(page==='automacoes')modulo=<AutomationsModule onBack={voltar}/>
 return <div className="app-shell"><header className="topbar"><button className="brand brand-button" type="button" onClick={voltar}><div className="brand-mark">N</div><div><strong>Painel Comercial</strong><span>Equipe Norte</span></div></button><div className="topbar-actions"><span className="environment-badge">Nova versão</span><button className="profile-button" type="button">MB</button></div></header>{modulo}<footer><span>Painel Comercial · Equipe Norte</span><span>Módulo ativo</span></footer></div>
}
