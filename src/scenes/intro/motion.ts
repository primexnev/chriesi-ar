import { Euler, Group, Object3D, Quaternion, Vector3 } from 'three';

type Action = 'idle' | 'walk' | 'search' | 'thanks' | 'dig';
const UP = new Vector3(0,1,0);
const STRIDE = .09;
const smooth = (x:number) => x*x*(3-2*x);

/** One ordered pose pass: feet/body -> tool -> wrists/palms. All units are page units. */
export class VillagerMotion {
  action: Action = 'idle';
  held = false;
  pickup = 0;
  digPhase = 0;
  private root: Group;
  private actor: Group;
  private model: Object3D;
  private tool: Group;
  private rest = new Map<Object3D,Quaternion>();
  private footRest = new Map<string,Quaternion>();
  private phase = 0;
  private weight = 0;
  private gripWeight = 0;
  private previous: Vector3;
  private sourcePosition: Vector3;
  private sourceQuaternion: Quaternion;
  private palms = new Map<string,Object3D>();

  constructor(root:Group, actor:Group, model:Object3D, tool:Group) {
    this.root=root; this.actor=actor; this.model=model; this.tool=tool;
    this.previous=actor.position.clone();
    this.sourcePosition=tool.position.clone();this.sourceQuaternion=tool.quaternion.clone();
    root.updateMatrixWorld(true);
    model.traverse(o=>{if(o.type==='Bone')this.rest.set(o,o.quaternion.clone());});
    for(const side of ['L','R']) {
      const foot=model.getObjectByName('Foot_'+side);
      if(foot)this.footRest.set(side,actor.getWorldQuaternion(new Quaternion()).invert().multiply(foot.getWorldQuaternion(new Quaternion())));
      const hand=model.getObjectByName('Hand_'+side);
      if(hand){const palm=new Object3D();palm.name='Grip_'+side;palm.position.y=.025;hand.add(palm);this.palms.set(side,palm);}
    }
  }

  beginPickup():void {
    this.sourcePosition.copy(this.tool.position);this.sourceQuaternion.copy(this.tool.quaternion);
    this.held=true;this.pickup=0;
  }
  private pose(name:string,x:number,y=0,z=0):void {
    const bone=this.model.getObjectByName(name),rest=bone&&this.rest.get(bone);
    if(!bone||!rest)return;
    bone.quaternion.copy(rest).multiply(new Quaternion().setFromEuler(new Euler(x,y,z)));
  }
  private aim(bone:Object3D,child:Object3D,target:Vector3):void {
    const start=bone.getWorldPosition(new Vector3());
    const current=child.getWorldPosition(new Vector3()).sub(start).normalize();
    const desired=target.clone().sub(start).normalize();
    const world=new Quaternion().setFromUnitVectors(current,desired).multiply(bone.getWorldQuaternion(new Quaternion()));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    bone.updateWorldMatrix(false,true);
  }
  private solve(first:string,second:string,end:string,target:Vector3,pole:Vector3):void {
    const a=this.model.getObjectByName(first),b=this.model.getObjectByName(second),c=this.model.getObjectByName(end);
    if(!a||!b||!c)return;
    const p=a.getWorldPosition(new Vector3()),q=b.getWorldPosition(new Vector3()),r=c.getWorldPosition(new Vector3());
    const upper=p.distanceTo(q),lower=q.distanceTo(r);
    const dir=target.clone().sub(p),raw=dir.length();if(raw<1e-8)return;dir.divideScalar(raw);
    const d=Math.max(Math.abs(upper-lower)+1e-6,Math.min(raw,upper+lower-1e-6));
    const endpoint=p.clone().addScaledVector(dir,d);
    const along=(upper*upper-lower*lower+d*d)/(2*d);
    const bend=pole.clone().sub(p);bend.addScaledVector(dir,-bend.dot(dir)).normalize();
    const elbow=p.clone().addScaledVector(dir,along).addScaledVector(bend,Math.sqrt(Math.max(0,upper*upper-along*along)));
    this.aim(a,b,elbow);this.aim(b,c,endpoint);
  }

  update(dt:number,time:number):void {
    if(dt<=0)return;
    const distance=this.actor.position.distanceTo(this.previous);this.previous.copy(this.actor.position);
    this.phase+=distance/STRIDE;
    const blend=1-Math.exp(-dt*18);
    this.weight+=((this.action==='walk'?1:0)-this.weight)*blend;
    this.gripWeight+=((this.held?1:0)-this.gripWeight)*blend;
    for(const [bone,q] of this.rest)bone.quaternion.copy(q);
    const cycle=Math.sin(this.phase*Math.PI*2);
    const stroke=this.action==='dig'?Math.sin(this.digPhase*Math.PI)**2:0;
    this.model.position.y=-.003+Math.sin(this.phase*Math.PI*4)*.0008*this.weight;
    this.pose('Spine',this.action==='dig'?.10+stroke*.15:0,0,cycle*.012*this.weight);
    this.pose('Head',this.action==='dig'?.10:0,this.action==='search'?Math.sin(time*1.4)*.26:0);
    for(const side of ['L','R']) {
      const sign=side==='L'?1:-1;
      this.pose('UpperArm_'+side,-1.3,0,-cycle*.18*sign*this.weight);
      this.pose('Forearm_'+side,-.08);
    }
    if(this.action==='thanks'&&!this.held)this.pose('Forearm_R',-.65,Math.sin(time*7)*.12);
    this.root.updateMatrixWorld(true);
    // Half cycle in stance: rearward local travel exactly cancels forward root travel.
    for(const side of ['L','R']) {
      const sign=side==='L'?1:-1;
      const phase=(this.phase+(side==='R'?.5:0))%1;
      const u=phase<.5?phase*2:(phase-.5)*2;
      const z=phase<.5?STRIDE/4-u*STRIDE/2:-STRIDE/4+smooth(u)*STRIDE/2;
      const lift=phase<.5?0:Math.sin(u*Math.PI)*.012;
      const ankle=this.actor.localToWorld(new Vector3(sign*.017,.011+lift*this.weight,z*this.weight));
      this.solve('Thigh_'+side,'Shin_'+side,'Foot_'+side,ankle,this.actor.localToWorld(new Vector3(sign*.017,.05,.15)));
      const foot=this.model.getObjectByName('Foot_'+side),rest=this.footRest.get(side);
      if(foot&&rest){const q=this.actor.getWorldQuaternion(new Quaternion()).multiply(rest);foot.quaternion.copy(foot.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(q));foot.updateWorldMatrix(false,true);}
    }
    if(this.held) {
      // Both carrying and digging use these same shaft sockets. No reparenting or teleporting.
      const local=new Vector3(0,this.action==='dig'?.012-stroke*.018:.012,.036);
      const tilt=new Quaternion().setFromEuler(new Euler(this.action==='dig'?-.08+stroke*.18:-.08,0,0));
      const targetPosition=this.root.worldToLocal(this.actor.localToWorld(local));
      const targetQuaternion=this.root.getWorldQuaternion(new Quaternion()).invert().multiply(this.actor.getWorldQuaternion(new Quaternion())).multiply(tilt);
      this.tool.position.lerpVectors(this.sourcePosition,targetPosition,smooth(this.pickup));
      this.tool.quaternion.slerpQuaternions(this.sourceQuaternion,targetQuaternion,smooth(this.pickup));
      this.tool.updateWorldMatrix(true,true);
    }
    if(this.gripWeight>.001) {
      for(const side of ['R','L']) {
        const hand=this.model.getObjectByName('Hand_'+side),palm=this.palms.get(side);if(!hand||!palm)continue;
        const desired=this.tool.localToWorld(new Vector3(0,side==='R'?.13:.105,0));
        const target=palm.getWorldPosition(new Vector3()).lerp(desired,this.gripWeight*smooth(this.pickup));
        const inward=new Vector3(side==='R'?1:-1,0,0);
        const handQ=this.tool.getWorldQuaternion(new Quaternion()).multiply(new Quaternion().setFromUnitVectors(UP,inward));
        const scale=hand.getWorldScale(new Vector3());
        const offset=palm.position.clone().multiply(scale).applyQuaternion(handQ);
        const wrist=target.clone().sub(offset);
        this.solve('UpperArm_'+side,'Forearm_'+side,'Hand_'+side,wrist,this.actor.localToWorld(new Vector3(side==='R'?-.10:.10,.08,-.04)));
        hand.quaternion.copy(hand.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(handQ));hand.updateWorldMatrix(false,true);
      }
    }
  }
}
