import * as THREE from 'three';

const cube = new THREE.BoxGeometry(1, 1, 1);
const materials = new Map<string, THREE.MeshLambertMaterial>();
function material(color: string, glow = false): THREE.MeshLambertMaterial {
  const key = `${color}:${glow}`;
  let value = materials.get(key);
  if (!value) {
    value = new THREE.MeshLambertMaterial({ color, emissive: glow ? color : '#000000', emissiveIntensity: glow ? 0.8 : 0 });
    materials.set(key, value);
  }
  return value;
}

type Joint = { node: THREE.Group; role: string; phase: number; rest: THREE.Vector3 };
type ActorRig = { root: THREE.Group; kind: string; joints: Joint[]; radial?: THREE.Mesh; rush?: THREE.Group; charge?: THREE.Mesh };
const radialGeometry = new THREE.RingGeometry(4.35, 4.5, 64);
const chargeGeometry = new THREE.RingGeometry(0.94, 1, 64);
const warningMaterial = new THREE.MeshBasicMaterial({ color: '#ffbc64', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
const rushMaterial = new THREE.MeshBasicMaterial({ color: '#f27c64', transparent: true, opacity: 0.75, depthWrite: false });
export const bossKind = (kind: string) => kind === 'cinder_guardian' || kind === 'aether_crown';

export function makeActor(kind: string, color?: string): THREE.Group {
  const group = new THREE.Group(), root = new THREE.Group();
  group.name = `actor:${kind}`; root.name = 'rig'; group.add(root);
  const rig: ActorRig = { root, kind, joints: [] };
  group.userData.actor = rig;
  const part = (parent: THREE.Group, name: string, tint: string, x: number, y: number, z: number, w: number, h: number, d: number, glow = false) => {
    const mesh = new THREE.Mesh(cube, material(tint, glow));
    mesh.name = name; mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
    return mesh;
  };
  const joint = (name: string, role: string, x: number, y: number, z: number, phase = 0, parent = root) => {
    const node = new THREE.Group(); node.name = name; node.position.set(x, y, z); parent.add(node);
    rig.joints.push({ node, role, phase, rest: node.position.clone() });
    return node;
  };
  const eyes = (head: THREE.Group, separation: number, y: number, z: number, glow = false) => {
    for (const side of [-1, 1]) {
      part(head, 'eye', glow ? '#ffc879' : '#fff0d6', side * separation, y, z, 0.085, 0.07, 0.025, glow);
      if (!glow) part(head, 'pupil', '#293638', side * separation, y, z + 0.015, 0.035, 0.06, 0.015);
    }
  };
  if (bossKind(kind)) {
    if (kind === 'cinder_guardian') {
      const shell = joint('kiln-shell', 'torso', 0, 1.1, 0);
      part(shell, 'basalt-shell', '#493d48', 0, 0.6, 0, 1.6, 1.65, 1.15);
      part(shell, 'furnace-heart', '#ffb35b', 0, 0.55, 0.59, 0.55, 0.85, 0.08, true);
      part(shell, 'brow-slab', '#765148', 0, 1.4, 0.18, 1.9, 0.28, 1.1);
      part(shell, 'visor', '#ffe0a1', 0, 1.15, 0.6, 0.95, 0.12, 0.06, true);
      for (const side of [-1, 1]) {
        const hammer = joint(`hammer:${side}`, 'hammer', side * 1.1, 1.15, 0, side, shell);
        part(hammer, 'stone-hammer', '#61454a', 0, -0.65, 0.12, 0.75, 1.15, 0.9);
        part(hammer, 'hot-seam', '#ef8950', 0, -0.6, 0.58, 0.5, 0.13, 0.04, true);
        const foot = joint(`pillar:${side}`, 'leg', side * 0.53, 0.9, 0, side);
        part(foot, 'pillar-foot', '#3b3540', 0, -0.45, 0.16, 0.65, 0.9, 0.95);
        part(shell, 'chimney', '#372f3c', side * 0.52, 1.75, -0.25, 0.35, 0.75, 0.4);
      }
    } else {
      root.scale.setScalar(1.2);
      const core = joint('crown-core', 'spin', 0, 1.65, 0);
      part(core, 'prism-heart', '#adfff0', 0, 0, 0, 0.65, 0.95, 0.65, true).rotation.z = Math.PI / 4;
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3;
        const spire = joint(`crown-spire:${i}`, 'crown', Math.sin(angle) * 1.1, 1.7, Math.cos(angle) * 1.1, angle);
        part(spire, 'floating-spire', '#8a81b5', 0, 0, 0, 0.4, 1.4, 0.4);
        part(spire, 'luminous-tip', '#d5fff5', 0, 0.8, 0, 0.23, 0.4, 0.23, true);
        part(spire, 'lower-shard', '#627b9d', 0, -1, 0, 0.25, 0.5, 0.25);
      }
    }
    rig.radial = new THREE.Mesh(radialGeometry, warningMaterial);
    rig.radial.name = 'radial-warning'; rig.radial.rotation.x = -Math.PI / 2; rig.radial.position.y = 0.06;
    rig.charge = new THREE.Mesh(chargeGeometry, warningMaterial);
    rig.charge.name = 'charge-progress'; rig.charge.rotation.x = -Math.PI / 2; rig.charge.position.y = 0.07;
    rig.rush = new THREE.Group(); rig.rush.name = 'rush-warning';
    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(cube, rushMaterial);
      edge.position.set(side * 1.6, 0.08, 4.2); edge.scale.set(0.07, 0.045, 8.4); rig.rush.add(edge);
      const arrow = new THREE.Mesh(cube, rushMaterial);
      arrow.position.set(side * 0.35, 0.08, 7.9); arrow.scale.set(0.08, 0.045, 1); arrow.rotation.y = side * -Math.PI / 4; rig.rush.add(arrow);
    }
    for (const warning of [rig.radial, rig.charge, rig.rush]) {
      warning.visible = false;
      warning.traverse(node => { node.userData.telegraph = true; node.renderOrder = 2; });
      group.add(warning);
    }
  } else if (kind === 'grazer') {
    const fur = color ?? '#bd9871';
    part(root, 'body', fur, 0, 0.75, -0.08, 0.62, 0.57, 1.02);
    part(root, 'saddle-mark', '#e7ce9f', 0, 1.025, -0.17, 0.45, 0.055, 0.58);
    const head = joint('head', 'graze', 0, 0.95, 0.5);
    part(head, 'face', fur, 0, 0.08, 0.08, 0.36, 0.42, 0.42);
    part(head, 'muzzle', '#ead5b6', 0, -0.05, 0.32, 0.31, 0.17, 0.19);
    eyes(head, 0.12, 0.13, 0.296);
    for (const side of [-1, 1]) {
      const ear = joint(`ear:${side}`, 'ear', side * 0.23, 0.24, 0.04, side, head);
      part(ear, 'ear', fur, 0, 0.13, 0, 0.13, 0.32, 0.09);
      part(ear, 'inner-ear', '#c78077', 0, 0.14, 0.05, 0.055, 0.2, 0.02);
      for (const end of [-1, 1]) {
        const leg = joint(`leg:${side}:${end}`, 'leg', side * 0.22, 0.51, end * 0.37, side * end);
        part(leg, 'leg', fur, 0, -0.21, 0, 0.15, 0.42, 0.17);
        part(leg, 'hoof', '#55463e', 0, -0.46, 0.025, 0.17, 0.1, 0.21);
      }
    }
    const tail = joint('tail', 'tail', 0, 0.89, -0.62);
    part(tail, 'tail', '#68543f', 0, -0.1, -0.09, 0.1, 0.25, 0.16);
  } else if (kind === 'peep') {
    const feathers = color ?? '#e9c878';
    part(root, 'body', feathers, 0, 0.36, 0, 0.38, 0.4, 0.48);
    part(root, 'bib', '#fff0c6', 0, 0.36, 0.24, 0.27, 0.25, 0.025);
    const head = joint('head', 'head', 0, 0.59, 0.16);
    part(head, 'head', feathers, 0, 0, 0, 0.32, 0.3, 0.3);
    part(head, 'crest', '#a95548', 0, 0.18, -0.04, 0.075, 0.16, 0.22);
    part(head, 'beak', '#d68140', 0, -0.04, 0.21, 0.12, 0.1, 0.15);
    eyes(head, 0.1, 0.02, 0.16);
    for (const side of [-1, 1]) {
      const wing = joint(`wing:${side}`, 'wing', side * 0.17, 0.47, -0.025, side);
      part(wing, 'wing', feathers, side * 0.2, 0, 0, 0.4, 0.085, 0.32);
      part(wing, 'wing-tip', '#92734d', side * 0.39, 0, -0.06, 0.12, 0.075, 0.24);
      part(root, 'foot', '#d68140', side * 0.09, 0.08, 0.09, 0.07, 0.13, 0.2);
    }
    part(root, 'tail', '#92734d', 0, 0.38, -0.33, 0.18, 0.08, 0.25).rotation.x = -0.35;
  } else if (kind === 'skitter') {
    const shell = color ?? '#625273';
    part(root, 'carapace', shell, 0, 0.39, -0.14, 0.58, 0.36, 0.65);
    part(root, 'ridge', '#9d827e', 0, 0.58, -0.2, 0.15, 0.07, 0.4);
    const head = joint('head', 'head', 0, 0.35, 0.32);
    part(head, 'head', shell, 0, 0, 0, 0.36, 0.24, 0.26);
    eyes(head, 0.11, 0.02, 0.14, true);
    for (const side of [-1, 1]) {
      part(head, 'fang', '#dac8ad', side * 0.1, -0.12, 0.21, 0.055, 0.18, 0.12);
      for (let i = 0; i < 3; i++) {
        const leg = joint(`leg:${side}:${i}`, 'skitter', side * 0.23, 0.38, i * 0.26 - 0.32, side * (i % 2 ? -1 : 1));
        part(leg, 'upper-leg', shell, side * 0.2, -0.04, 0, 0.42, 0.09, 0.095).rotation.z = side * -0.25;
        part(leg, 'lower-leg', '#383340', side * 0.37, -0.23, 0, 0.07, 0.3, 0.07).rotation.z = side * 0.2;
      }
    }
  } else if (kind === 'wisp' || kind === 'drop') {
    const glow = kind === 'wisp', tint = color ?? (glow ? '#91e9d6' : '#d1b17d');
    const core = joint('core', 'spin', 0, 0.36, 0);
    part(core, 'core', tint, 0, 0, 0, 0.28, 0.28, 0.28, glow);
    if (glow) {
      eyes(core, 0.075, 0, 0.15);
      for (let i = 0; i < 4; i++) {
        const spark = joint(`spark:${i}`, 'spark', Math.cos(i * Math.PI / 2) * 0.3, 0.36, Math.sin(i * Math.PI / 2) * 0.3, i);
        part(spark, 'spark', '#d2fff3', 0, 0, 0, 0.095, 0.095, 0.095, true);
      }
    }
  } else {
    const hostile = kind === 'shambler', ember = kind === 'emberling', trader = kind === 'trader';
    const cloth = color ?? (hostile ? '#697f67' : ember ? '#754638' : trader ? '#826699' : '#427e87');
    const skin = hostile ? '#a5ae7b' : ember ? '#bb714b' : '#d9ac86';
    const torso = joint('torso', 'torso', 0, 0.8, 0);
    part(torso, 'coat', cloth, 0, 0.29, 0, 0.5, 0.59, 0.28);
    part(torso, 'belt', '#594336', 0, 0.045, 0, 0.52, 0.09, 0.3);
    part(torso, 'buckle', '#d9b56a', 0, 0.045, 0.16, 0.085, 0.075, 0.025);
    const head = joint('head', 'head', 0, 0.66, hostile ? 0.07 : 0, 0, torso);
    part(head, 'face', skin, 0, 0.13, 0, 0.4, 0.4, 0.38);
    part(head, 'hair', ember ? '#3f302d' : '#574334', 0, 0.33, -0.025, 0.43, 0.1, 0.4);
    part(head, 'hair-back', '#574334', 0, 0.17, -0.19, 0.43, 0.28, 0.06);
    eyes(head, 0.105, 0.15, 0.2, hostile || ember);
    part(head, 'nose', skin, 0, 0.07, 0.225, 0.075, 0.09, 0.08);
    part(head, 'mouth', '#885e50', 0, -0.005, 0.2, 0.11, 0.025, 0.02);
    for (const side of [-1, 1]) {
      const arm = joint(`arm:${side}`, 'arm', side * 0.35, 0.51, 0, side, torso);
      part(arm, 'sleeve', cloth, 0, -0.17, 0, 0.18, 0.36, 0.22);
      part(arm, 'hand', skin, 0, -0.42, 0, 0.16, 0.17, 0.18);
      const leg = joint(`leg:${side}`, 'leg', side * 0.135, 0.8, 0, side);
      part(leg, 'trousers', '#444c55', 0, -0.3, 0, 0.21, 0.59, 0.24);
      part(leg, 'boot', '#4b3b34', 0, -0.68, 0.035, 0.23, 0.24, 0.31);
    }
    if (hostile) {
      part(torso, 'moss-shoulder', '#8d9b69', -0.2, 0.61, -0.05, 0.28, 0.2, 0.3);
      part(torso, 'hump', '#586a54', 0.09, 0.45, -0.23, 0.35, 0.4, 0.23);
      part(head, 'brow', '#697f67', -0.09, 0.235, 0.23, 0.21, 0.045, 0.06).rotation.z = -0.2;
    } else if (ember) {
      part(torso, 'ember-heart', '#ffc073', 0, 0.33, 0.16, 0.16, 0.24, 0.04, true);
      for (const side of [-1, 1]) part(head, 'horn', '#f4a060', side * 0.16, 0.5, -0.02, 0.08, 0.26, 0.1, true).rotation.z = side * -0.3;
    } else {
      part(torso, 'satchel', '#a56b3f', -0.3, 0.13, -0.12, 0.22, 0.29, 0.32);
      part(torso, 'satchel-flap', '#684936', -0.3, 0.24, 0.049, 0.24, 0.12, 0.025);
      part(torso, 'strap', '#74553c', 0, 0.32, 0.151, 0.065, 0.64, 0.025).rotation.z = -0.55;
      part(torso, 'scarf', '#d1a454', 0, 0.59, 0, 0.42, 0.11, 0.34);
      if (trader) {
        part(head, 'hat-brim', '#6b4c75', 0, 0.39, 0, 0.59, 0.055, 0.52);
        part(head, 'hat-crown', cloth, 0, 0.48, -0.02, 0.42, 0.18, 0.37);
        part(torso, 'backpack', '#977348', 0, 0.28, -0.29, 0.4, 0.48, 0.28);
      }
    }
  }
  return group;
}

export function animateActor(group: THREE.Group, time: number, speed = 0, state = 'idle', phase = 1, attackTimer = 0): void {
  const rig = group.userData.actor as ActorRig | undefined;
  if (!rig) return;
  const { root, kind, joints } = rig;
  const gait = Math.min(1, Math.abs(speed) / (kind === 'grazer' ? 1.5 : 4.5));
  const cycle = time * (kind === 'skitter' ? 15 : 8), swing = Math.sin(cycle) * gait;
  const dead = state === 'dead' || state === 'sleep';
  const radial = state === 'windup_radial', rushing = state === 'windup_rush' || state === 'rush';
  const charge = THREE.MathUtils.clamp(1 - attackTimer / (radial ? 1.2 : 1), 0, 1);
  if (rig.radial && rig.charge && rig.rush) {
    rig.radial.visible = radial;
    rig.rush.visible = rushing;
    rig.charge.visible = radial || state === 'windup_rush';
    rig.charge.scale.setScalar(Math.max(0.02, charge) * (radial ? 4.5 : 1.6));
    rig.rush.scale.z = state === 'rush' ? THREE.MathUtils.clamp(attackTimer / 0.7, 0, 1) : 1;
  }
  root.position.set(0, dead ? 0.22 : kind === 'peep' || kind === 'wisp' ? 0.12 + Math.sin(time * 3) * 0.06 : Math.abs(Math.sin(cycle)) * gait * 0.035, 0);
  root.rotation.set(bossKind(kind) && phase === 2 && rushing ? 0.18 : 0, 0, dead ? Math.PI / 2 : 0);
  for (const { node, role, phase, rest } of joints) {
    node.position.copy(rest); node.rotation.set(0, 0, 0);
    if (dead) continue;
    if (role === 'hammer') node.rotation.x = radial ? -charge * 1.8 : rushing ? -1.3 : swing * phase * 0.3;
    else if (role === 'crown') {
      const radius = 1.1 + (rushing ? charge * 0.3 : 0);
      node.position.set(Math.sin(phase + time * 0.3) * radius, rest.y + Math.sin(time * 2 + phase) * 0.1, Math.cos(phase + time * 0.3) * radius);
      node.rotation.y = -phase - time * 0.3;
    }
    else if (role === 'leg') node.rotation.x = swing * phase * 0.7;
    else if (role === 'arm') node.rotation.x = -swing * phase * 0.7 + (kind === 'shambler' ? -0.7 : 0) - (state === 'attack' || state === 'use' ? 1.2 + Math.sin(time * 15) * 0.35 : 0);
    else if (role === 'torso') { node.rotation.y = swing * 0.055; node.rotation.x = kind === 'shambler' ? 0.14 : state === 'crouch' ? 0.22 : 0; }
    else if (role === 'head') { node.rotation.y = Math.sin(time * 1.2) * 0.065; node.rotation.x = state === 'eat' ? 0.3 + Math.sin(time * 9) * 0.16 : 0; }
    else if (role === 'graze') node.rotation.x = state === 'eat' || state === 'graze' ? 0.7 + Math.sin(time * 3) * 0.08 : Math.sin(time * 1.5) * 0.06;
    else if (role === 'ear') node.rotation.z = phase * (0.24 + Math.sin(time * 3 + phase) * 0.09);
    else if (role === 'tail') node.rotation.y = Math.sin(time * 4) * 0.3;
    else if (role === 'wing') node.rotation.z = phase * (0.2 + Math.sin(time * (state === 'fly' ? 25 : 16)) * 0.75);
    else if (role === 'skitter') { node.rotation.y = swing * phase * 0.4; node.rotation.z = Math.cos(cycle) * phase * gait * 0.2; }
    else if (role === 'spin') { node.rotation.y = time * 0.9; node.position.y += Math.sin(time * 3) * 0.045; }
    else if (role === 'spark') {
      node.position.set(Math.cos(time * 1.8 + phase * Math.PI / 2) * 0.34, rest.y + Math.sin(time * 3 + phase) * 0.17, Math.sin(time * 1.8 + phase * Math.PI / 2) * 0.34);
      node.rotation.set(time, time * 0.7, phase);
    }
  }
}
