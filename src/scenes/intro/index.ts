import { BoxGeometry, CylinderGeometry, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, TorusGeometry, Vector3, type Object3D } from 'three';
import type { StoryContext } from '../../story/context';
import { linear } from '../../core/clock';
import { VillagerMotion } from './motion';
import { TapMarker } from '../shared/marker';
import { cherryTree, person, rng } from '../shared/placeholders';

/** Intro prototype; all animation uses the pausable story clock, including idle help. */
export async function runIntro(ctx: StoryContext): Promise<{ dispose(): void }> {
  const { stage, narrator, sfx } = ctx;
  const clock = stage.clock;
  const root = new Group(); root.name = 'excavation-intro'; stage.content.add(root);
  const materials: MeshLambertMaterial[] = [];
  const material = (color: number) => { const m = new MeshLambertMaterial({color}); materials.push(m); return m; };
  const green=material(0x88ab60), soil=material(0x775039), wood=material(0x986236), gold=material(0xd6ab53), cream=material(0xf6e9ce), steel=material(0x879b9b), red=material(0xc8263a);
  const box = (w:number,h:number,d:number,m:MeshLambertMaterial) => new Mesh(new BoxGeometry(w,h,d),m);
  const add = (o:Object3D,x:number,y:number,z:number,parent:Object3D=root) => {o.position.set(x,y,z);parent.add(o);return o;};
  root.add(new HemisphereLight(0xfff6e4,0x80995e,2));
  const light=new DirectionalLight(0xffe5be,2.2);light.position.set(-.3,1,.5); root.add(light,light.target);
  const meadow=new Mesh(new CylinderGeometry(.46,.48,.018,48),green); meadow.scale.z=.72;add(meadow,0,-.009,0);
  const random=rng(53);
  for(let i=0;i<45;i++) {
    const x=(random()-.5)*.82,z=(random()-.5)*.54;
    if(Math.abs(x)<.24 && z>-.1)continue;
    const grass=new Mesh(new CylinderGeometry(.001,.004,.022,3),green);add(grass,x,.01,z);
    if(i%4===0)add(new Mesh(new SphereGeometry(.004,5,4),cream),x,.023,z);
  }
  for(const x of [-.35,.32]) {const tree=cherryTree(1.35,x<0?4:8);add(tree,x,0,-.19);}
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
  add(shovel,-.23,.006,-.035);shovel.rotation.z=-.28;
  const hit=new Mesh(new SphereGeometry(.052,10,8),new MeshBasicMaterial({visible:false}));add(hit,0,.07,0,shovel);
  const motion=new VillagerMotion(root,actor,model,shovel);
  let poseTime=clock.time;
  const offAnimation=stage.onBeforeRender(()=>{
    const dt=clock.time-poseTime;poseTime=clock.time;motion.update(dt,clock.time);
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
  const walk=async(x:number,z:number)=>{
    const from=actor.position.clone(),to=new Vector3(x,0,z);
    const angle=Math.atan2(to.x-from.x,to.z-from.z);
    const fromAngle=actor.rotation.y;const delta=Math.atan2(Math.sin(angle-fromAngle),Math.cos(angle-fromAngle));
    await clock.tween(250,k=>{actor.rotation.y=fromAngle+delta*k;});motion.action='walk';
    await clock.tween(Math.max(1000,from.distanceTo(to)*9500),k=>actor.position.lerpVectors(from,to,k),linear);motion.action='idle';
  };
  ctx.focus(new Vector3(0,.06,.02),.9);
  await Promise.all([walk(-.03,.12),narrator.say('intro_walk')]);
  actor.rotation.y=Math.PI/2;
  await narrator.say('intro_spot');
  motion.action='search';await narrator.say('intro_search');
  actor.rotation.y=0; marker.show();
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
  // Turn towards the tool, reach, then lift it with both palm sockets following the shaft.
  actor.rotation.y=Math.PI;
  motion.beginPickup();
  await clock.tween(1400,k=>{motion.pickup=k;});
  await walk(.070,.07);actor.rotation.y=Math.PI/2;
  await narrator.say('intro_dig');
  motion.action='dig';
  for(let stroke=0;stroke<5;stroke++){
    await clock.tween(1100,k=>{
      motion.digPhase=k;
      if(k>.45){chips.forEach((c,i)=>{c.visible=true;const a=(k-.45)/.55;c.position.set(.12+Math.cos(i*2)*a*.08,.018+Math.sin(a*Math.PI)*.06,.07+Math.sin(i*2)*a*.08);c.scale.setScalar(1-a*.7);});}
    },linear);
    chips.forEach(c=>c.visible=false);sfx.plop();mound.scale.y=Math.max(.01,.25-(stroke+1)*.048);
  }
  motion.action='idle';chest.visible=true;mound.visible=false;sfx.bell();
  await Promise.all([clock.tween(1500,k=>{chest.position.y=-.035+k*.04;}),narrator.say('intro_chest')]);
  await clock.tween(1200,k=>{lid.rotation.x=-k*1.85;});
  treasure.visible=true;sfx.fanfare();
  await clock.tween(1500,k=>{book.position.y=.07+k*.07;seed.position.y=.08+k*.07;halo.position.y=seed.position.y;});
  actor.rotation.y=.3;motion.action='thanks';await narrator.say('intro_treasure');motion.action='idle';
  await narrator.say('intro_end');
  return {dispose(){
    offAnimation();offTreasure();marker.hide();button.remove();stage.content.remove(root);
    // Only procedural geometry is owned here. Library geometry is reused on replay.
    model.removeFromParent();
    root.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose();});
    materials.forEach(m=>m.dispose());(hit.material as MeshBasicMaterial).dispose();marker.sprite.material.dispose();
  }};
}
