import { BoxGeometry, CircleGeometry, CylinderGeometry, DirectionalLight, Group, HemisphereLight, InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import type { StoryContext } from '../../story/context';
import { linear } from '../../core/clock';
import { VillagerMotion } from './motion';
import { BLOCK_DEPTH, buildLandscape, heightAt } from './landscape';
import { TapMarker } from '../shared/marker';
import { cherryTree, person, rng } from '../shared/placeholders';

/** Trapezoid speed profile: ease in over `ramp`, constant speed, ease out over `ramp`. */
function ramped(t: number, ramp: number): number {
  const v = 1 / (1 - ramp);
  if (t < ramp) return v * t * t / (2 * ramp);
  if (t > 1 - ramp) return 1 - v * (1 - t) * (1 - t) / (2 * ramp);
  return v * (t - ramp / 2);
}

/** Intro prototype; all animation uses the pausable story clock, including idle help. */
export async function runIntro(ctx: StoryContext): Promise<{ dispose(): void }> {
  const { stage, narrator, sfx } = ctx;
  const clock = stage.clock;
  const root = new Group(); root.name = 'excavation-intro'; stage.content.add(root);
  // The landscape is a block with a lake basin; lift it so the lake bed stays above the page.
  root.position.y = BLOCK_DEPTH;
  const materials: MeshLambertMaterial[] = [];
  const material = (color: number) => { const m = new MeshLambertMaterial({color}); materials.push(m); return m; };
  const soil=material(0x775039), wood=material(0x986236), gold=material(0xd6ab53), cream=material(0xf6e9ce), steel=material(0x879b9b), red=material(0xc8263a);
  const box = (w:number,h:number,d:number,m:MeshLambertMaterial) => new Mesh(new BoxGeometry(w,h,d),m);
  const add = (o:Object3D,x:number,y:number,z:number,parent:Object3D=root) => {o.position.set(x,y,z);parent.add(o);return o;};
  root.add(new HemisphereLight(0xeaf3ff,0x7d9a5c,1.8));
  const light=new DirectionalLight(0xffe2b8,2.4);light.position.set(-.35,1,.45); root.add(light,light.target);
  // Meadow, Lake Zug, foothills and Alps; animated on the story clock.
  const land=buildLandscape(ctx.quality);root.add(land.group);
  const blob=(rx:number,rz:number,x:number,z:number)=>{const s=new Mesh(new CircleGeometry(1,20),land.shadowMaterial);s.rotation.x=-Math.PI/2;s.scale.set(rx,rz,1);add(s,x,.0008,z);return s;};
  // Cherry trees framing the meadow, with ripe cherries on the lake-facing side of the crowns.
  const cherryMesh=new InstancedMesh(new SphereGeometry(.006,7,5),red,40);let cherries=0;
  const random=rng(53),dummy=new Object3D();
  for(const [x,z,s,seed] of [[-.43,-.02,1.35,4],[.4,-.03,1.25,8],[.45,.21,.95,11]] as const){
    const tree=cherryTree(s,seed);add(tree,x,heightAt(x,z),z);blob(.06*s,.045*s,x,z);
    for(const c of tree.userData.crown as Array<{x:number;y:number;z:number;r:number}>)for(let k=0;k<4&&cherries<40;k++){
      const a=random()*Math.PI*2,b=.2+random()*1.1;
      dummy.position.set(x+c.x+Math.cos(a)*Math.sin(b)*c.r*.95,tree.position.y+c.y-Math.cos(b)*c.r*.6,z+c.z+Math.abs(Math.sin(a))*Math.sin(b)*c.r*.95);
      dummy.scale.setScalar(.8+random()*.4);dummy.updateMatrix();cherryMesh.setMatrixAt(cherries++,dummy.matrix);
    }
  }
  cherryMesh.count=cherries;root.add(cherryMesh);
  const offLand=clock.onUpdate((_dt,t)=>land.update(t));
  const pit=new Mesh(new CylinderGeometry(.09,.085,.007,24),soil);pit.scale.z=.7;add(pit,.12,.003,.07);
  const mound=new Mesh(new SphereGeometry(.065,12,6),soil);mound.scale.set(1,.25,.65);add(mound,.12,.01,.07);
  const actor=new Group();root.add(actor);actor.position.set(-.35,0,.13);
  const model=ctx.models.get('villager',()=>{const p=person(0x2a6fb5);p.scale.setScalar(25);return p;});
  model.scale.multiplyScalar(.20); actor.add(model);
  // Shovel at the edge of the meadow: broad blade + wooden shaft + D grip.
  const shovel=new Group();shovel.name='shovel';
  add(box(.032,.036,.005,steel),0,.018,0,shovel);
  add(new Mesh(new CylinderGeometry(.003,.003,.10,8),wood),0,.08,0,shovel);
  const grip=new Mesh(new TorusGeometry(.009,.002,5,12),wood);add(grip,0,.137,0,shovel);
  add(shovel,-.23,.006,-.035);shovel.rotation.z=-.28;shovel.scale.setScalar(.85);
  const hit=new Mesh(new SphereGeometry(.052,10,8),new MeshBasicMaterial({visible:false}));add(hit,0,.07,0,shovel);
  const motion=new VillagerMotion(root,actor,model,shovel);
  const actorShadow=blob(.03,.024,0,0);
  let poseTime=clock.time;
  const offAnimation=stage.onBeforeRender(()=>{
    const dt=clock.time-poseTime;poseTime=clock.time;motion.update(dt,clock.time);
    actorShadow.position.set(actor.position.x,.0008,actor.position.z);
  });
  const marker=new TapMarker(clock,.085);root.add(marker.sprite);marker.sprite.position.set(-.23,.09,-.035);
  // Chest appears only once excavated; lid rotates around its rear hinge.
  const chest=new Group();chest.visible=false;add(chest,.12,-.035,.07);
  add(box(.105,.055,.068,wood),0,.027,0,chest);
  for(const x of [-.035,.035])add(box(.008,.057,.070,gold),x,.028,0,chest);
  add(box(.014,.018,.005,gold),0,.042,.037,chest);
  const lid=new Group();add(lid,0,.055,-.034,chest);add(box(.108,.014,.07,wood),0,.007,.035,lid);
  for(const x of [-.035,.035])add(box(.008,.016,.072,gold),x,.008,.035,lid);
  const treasure=new Group();treasure.visible=false;root.add(treasure);
  const book=new Group();add(box(.065,.009,.048,red),0,0,0,book);add(box(.060,.008,.043,cream),0,.007,0,book);add(box(.065,.003,.048,red),0,.013,0,book);
  add(book,.075,.09,.07,treasure);
  const seed=new Mesh(new SphereGeometry(.012,12,8),wood);seed.scale.set(.75,1, .7);add(seed,.17,.095,.07,treasure);
  const halo=new Mesh(new TorusGeometry(.025,.0015,5,32),gold);add(halo,.17,.095,.065,treasure);
  const offTreasure=clock.onUpdate((_dt,t)=>{if(treasure.visible){book.rotation.y=Math.sin(t)*.2;seed.rotation.y=t;treasure.position.y=Math.sin(t*2)*.004;}});
  const chips:Mesh[]=[];
  for(let i=0;i<8;i++){const c=new Mesh(new SphereGeometry(.005,4,3),soil);c.visible=false;root.add(c);chips.push(c);}
  /** Turn on the spot; the motion layer steps the feet while the actor rotates. */
  const turnTo=(angle:number)=>{
    const from=actor.rotation.y,delta=Math.atan2(Math.sin(angle-from),Math.cos(angle-from));
    return clock.tween(Math.max(220,Math.abs(delta)*280),k=>{actor.rotation.y=from+delta*k;});
  };
  const walk=async(x:number,z:number)=>{
    const from=actor.position.clone(),to=new Vector3(x,0,z);
    await turnTo(Math.atan2(to.x-from.x,to.z-from.z));
    motion.action='walk';
    // Accelerate and slow down over ~0.35 s instead of starting and stopping at full speed.
    const duration=Math.max(800,from.distanceTo(to)*7000),ramp=Math.min(.3,350/duration);
    await clock.tween(duration,k=>actor.position.lerpVectors(from,to,ramped(k,ramp)),linear);
    motion.action='idle';
  };
  ctx.focus(new Vector3(0,.06,.02),.9);
  await Promise.all([walk(-.03,.12),narrator.say('intro_walk')]);
  await turnTo(Math.PI/2);
  await narrator.say('intro_spot');
  motion.action='search';await narrator.say('intro_search');
  await turnTo(0); marker.show();
  // The icon is a keyboard/screen-reader alternative to tapping the actual 3D shovel.
  const button=document.createElement('button');button.className='btn-icon intro-shovel';button.setAttribute('aria-label','Schaufel zeigen');
  button.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M13 3h6v6h-6zM16 9v12M10 21h12v4l-6 5-6-5z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>';
  document.getElementById('ui')!.appendChild(button);
  let selected=false;
  let select!:()=>void;
  const selection=new Promise<void>(resolve=>{select=()=>{if(!selected&&!clock.isPaused){selected=true;resolve();}};});
  const offTap=stage.addTapTarget(hit,select);button.addEventListener('click',select);
  const offDisabled=clock.onUpdate(()=>{button.disabled=clock.isPaused;});
  await narrator.say('intro_help');
  let elapsed=0;const offIdle=clock.onUpdate(dt=>{elapsed+=dt;if(elapsed>=35)select();});
  await selection;offIdle();offDisabled();offTap();button.remove();marker.hide();
  sfx.pop();motion.action='thanks';await narrator.say('intro_thanks');
  await walk(-.23,.01);
  // Turn towards the tool, bend and reach, grasp, then swing it onto the shoulder.
  await turnTo(Math.PI);
  motion.beginPickup();
  await clock.tween(2000,k=>{motion.pickup=k;});
  await walk(.020,.07);await turnTo(Math.PI/2);
  await narrator.say('intro_dig');
  motion.action='dig';
  for(let stroke=0;stroke<5;stroke++){
    let struck=false;
    await clock.tween(1100,k=>{
      motion.digPhase=k;
      if(k>=.4&&!struck){struck=true;sfx.plop();}
      // Soil leaves the blade during the toss, to the character's right.
      const a=(k-.72)/.28;
      chips.forEach((c,i)=>{c.visible=a>0&&a<1;if(!c.visible)return;c.position.set(.09+Math.cos(i*2)*.02*a,.03+Math.sin(a*Math.PI)*.05,.07+a*.07+Math.sin(i*2)*.015*a);c.scale.setScalar(1-a*.6);});
    },linear);
    chips.forEach(c=>c.visible=false);mound.scale.y=Math.max(.01,.25-(stroke+1)*.048);
  }
  motion.action='idle';chest.visible=true;mound.visible=false;sfx.bell();
  await Promise.all([clock.tween(1500,k=>{chest.position.y=-.035+k*.04;}),narrator.say('intro_chest')]);
  await clock.tween(1200,k=>{lid.rotation.x=-k*1.85;});
  treasure.visible=true;sfx.fanfare();
  await clock.tween(1500,k=>{book.position.y=.07+k*.07;seed.position.y=.08+k*.07;halo.position.y=seed.position.y;});
  await turnTo(.3);motion.action='thanks';await narrator.say('intro_treasure');motion.action='idle';
  await narrator.say('intro_end');
  return {dispose(){
    offAnimation();offTreasure();offLand();land.dispose();marker.hide();button.remove();stage.content.remove(root);
    // Only procedural geometry is owned here. Library geometry is reused on replay.
    model.removeFromParent();
    root.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose();});
    materials.forEach(m=>m.dispose());(hit.material as MeshBasicMaterial).dispose();marker.sprite.material.dispose();
  }};
}
