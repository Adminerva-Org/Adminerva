/**
 * Authenticated queue + WebSocket client for the optional Adminerva Java runtime.
 * Queue truth is supplied by the server. A disconnected browser does not invent
 * positions or silently start an alternative execution.
 */
export class AdminervaRuntimeClient {
  constructor({origin,getToken,onEvent}){
    const normalized=String(origin||'').trim().replace(/\/$/,'');
    if(!/^https:\/\//.test(normalized))throw Error('Interactive runtime requires HTTPS.');
    this.origin=normalized;
    this.getToken=getToken;
    this.onEvent=onEvent;
    this.id=null;this.streamToken=null;this.ws=null;this.poll=null;
    this.cancelled=false;this.state='idle';
  }
  emit(event){try{this.onEvent?.(event);}catch(error){console.warn('Runtime UI update failed',error);}}
  async request(path,{method='GET',body}={}){
    const token=await this.getToken();
    if(!token)throw Error('Sign in to request an interactive Java session.');
    const res=await fetch(this.origin+path,{
      method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    let data={};try{data=await res.json();}catch{}
    if(!res.ok)throw Error(data.error||'Runtime service returned '+res.status);
    return data;
  }
  async enqueue({files,entry}){
    if(this.id)throw Error('A runtime request is already active.');
    this.cancelled=false;
    const response=await this.request('/v1/executions',{method:'POST',body:{files,entry}});
    this.id=response.id;this.streamToken=response.streamToken;
    this.state=response.state||'queued';
    this.emit({type:'status',...response});
    this.openStream();
    return response;
  }
  openStream(){
    if(!this.id||!this.streamToken||this.cancelled)return;
    const wsOrigin=this.origin.replace(/^https:/,'wss:');
    const url=wsOrigin+'/v1/executions/'+encodeURIComponent(this.id)+'/stream';
    const socket=new WebSocket(url,['adminerva-runtime','key.'+this.streamToken]);
    this.ws=socket;
    socket.onmessage=event=>{
      let data;try{data=JSON.parse(event.data);}catch{return;}
      if(!data||typeof data.type!=='string')return;
      if(data.type==='status')this.state=data.state||this.state;
      this.emit(data);
      if(data.type==='exit'||(data.type==='status'&&['finished','cancelled','failed','expired'].includes(data.state))){
        this.dispose(false);
      }
    };
    socket.onerror=()=>this.emit({type:'connection',state:'lost'});
    socket.onclose=()=>{
      if(this.ws===socket)this.ws=null;
      if(!this.cancelled&&this.id&&!this.poll){
        this.emit({type:'connection',state:'reconnecting'});
        this.poll=setTimeout(()=>{this.poll=null;this.openStream();},3000);
      }
    };
  }
  sendInput(text){
    if(this.state!=='running'||this.ws?.readyState!==WebSocket.OPEN)return false;
    this.ws.send(JSON.stringify({type:'stdin',data:String(text)}));return true;
  }
  async cancel(){
    if(!this.id)return;
    const id=this.id;
    await this.request('/v1/executions/'+encodeURIComponent(id),{method:'DELETE'});
    this.dispose();
  }
  dispose(terminal=true){
    this.cancelled=true;
    if(this.poll){clearTimeout(this.poll);this.poll=null;}
    if(this.ws){const socket=this.ws;this.ws=null;socket.close();}
    if(terminal){this.id=null;this.streamToken=null;this.state='idle';}
    else {this.id=null;this.streamToken=null;}
  }
}
