import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Bone, Group, Object3D, Vector3 } from 'three';
import { VillagerMotion } from '../src/scenes/intro/motion.ts';
const bytes=readFileSync(new URL('../public/assets/models/villager.glb',import.meta.url));
const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
const joints=new Set(doc.skins.flatMap(s=>s.joints));
const nodes=doc.nodes.map((n,i)=>{const o=joints.has(i)?new Bone():new Object3D();o.name=n.name??'';if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);return o;});
doc.nodes.forEach((n,i)=>(n.children??[]).forEach(j=>nodes[i].add(nodes[j])));
const root=new Group(),actor=new Group(),model=new Group(),tool=new Group();
doc.scenes[doc.scene??0].nodes.forEach(i=>model.add(nodes[i]));root.add(actor,tool);actor.add(model);model.scale.setScalar(.2);
const motion=new VillagerMotion(root,actor,model,tool);
motion.beginPickup();motion.pickup=1;
let time=0,maxError=0;
for(const transformed of [false,true]){
 if(transformed){root.rotation.set(.25,.4,-.15);root.scale.setScalar(1.7);root.position.set(.2,.3,-.4);}
 for(const action of ['walk','dig']){
  motion.action=action;
  for(let i=0;i<360;i++){
   time+=1/120;if(action==='walk')actor.position.z+=.1/120;
   motion.digPhase=(i%120)/119;motion.update(1/120,time);root.updateMatrixWorld(true);
   if(i<100)continue;
   for(const side of ['R','L']){
    const palm=model.getObjectByName('Grip_'+side).getWorldPosition(new Vector3());
    const target=tool.localToWorld(new Vector3(0,side==='R'?.13:.105,0));
    const error=palm.distanceTo(target)/root.scale.x;maxError=Math.max(maxError,error);
    assert(error<.0015,`${action} ${side} grip drift: ${error}`);
   }
  }
 }
}
assert(Number.isFinite(maxError));console.log('Maximum palm-to-shaft error in page units:',maxError);

// With a constant root speed, a planted ankle must not drift over the meadow.
root.rotation.set(0,0,0);root.scale.setScalar(1);root.position.set(0,0,0);
motion.held=false;motion.action='walk';
let previous=null,maxSlide=0,measurements=0;
for(let i=0;i<600;i++){
 actor.position.z+=.1/120;time+=1/120;motion.update(1/120,time);root.updateMatrixWorld(true);
 const ankle=model.getObjectByName('Foot_L').getWorldPosition(new Vector3());
 if(previous&&i>100&&Math.abs(ankle.y-.011)<1e-5&&Math.abs(previous.y-.011)<1e-5){maxSlide=Math.max(maxSlide,ankle.distanceTo(previous));measurements++;}
 previous=ankle;
}
assert(measurements>50);assert(maxSlide<.0002,`Planted foot slides: ${maxSlide}`);
console.log('Maximum planted-ankle drift:',maxSlide,'over',measurements,'frames');
