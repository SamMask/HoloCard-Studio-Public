// 星雲加強（T-817，DESIGN §5「星雲加強」）：畫好的漩渦大圖鋪在卡片後面的斜盤面上、約 120 秒一圈；上面 2～3 條細絲旋臂各自不同速度慢轉；
// 很多閃爍的星點（少數金色、各自不同步）；卡片下方的光暈多一圈細光環、轉卡越快越亮；減少動態時全部靜止；
// 有自己的背景圖時大圖與細絲讓出來（光暈、光環、星點照舊）；大圖由 stage-switch 只交給星雲（貼圖歸 card-view 管）。
// 只建物件、求數字，不畫（畫面在 GPU 回歸頁第 15 節）。
import { Group, Mesh, Texture, type Material, type Node, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { ZOOM_DEFAULT } from '../src/interact/view';
import { ASPECT_HEIGHT } from '../src/model/types';
import { cameraDistance, cardBox } from '../src/render/fit';
import { createNebulaFx } from '../src/render/nebula-fx';
import {
  discFrame,
  initialNebulaMotion,
  NEBULA_BACKDROP,
  NEBULA_FILAMENTS,
  NEBULA_HALO,
  NEBULA_HALO_RING,
  NEBULA_SPIN,
  NEBULA_STARS,
  NEBULA_SWIRL,
  nebulaHaloGlow,
  nebulaStars,
  nebulaSwirlDisc,
  nebulaSwirlUv,
  stepNebula,
  type Vec3,
} from '../src/render/nebula-layout';
import { createStageSwitch, type NebulaPart, type StageBackdrop, type StagePart } from '../src/render/stage-switch';

const TAU = Math.PI * 2;
const FOV = 30;
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.sqrt(dot(a, a));

const swirlOf = (tag = 'nebula'): StageBackdrop => {
  const texture = new Texture({ tag } as unknown as HTMLImageElement);
  return { texture, width: 2048, height: 2048 };
};

/** 星雲的背景平面（第一個 renderOrder 最小的網格）。 */
const backdropMesh = (fx: ReturnType<typeof createNebulaFx>): Mesh => {
  const meshes: Mesh[] = [];
  fx.group.traverse((o: Object3D) => {
    if (o instanceof Mesh) meshes.push(o);
  });
  return meshes.sort((a, b) => a.renderOrder - b.renderOrder)[0]!;
};

/** 著色圖裡有沒有用到這個 uniform（往下走整張圖）。 */
function uses(root: Node, target: Node): boolean {
  const seen = new Set<Node>();
  const pending: Node[] = [root];
  while (pending.length) {
    const n = pending.pop()!;
    if (n === target) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    pending.push(...n.getChildren());
  }
  return false;
}

/** 著色圖裡用到的貼圖。 */
function textures(root: Node): Texture[] {
  const out = new Set<Texture>();
  const seen = new Set<Node>();
  const pending: Node[] = [root];
  while (pending.length) {
    const n = pending.pop()! as Node & { value?: unknown };
    if (seen.has(n)) continue;
    seen.add(n);
    if (n.value instanceof Texture) out.add(n.value);
    pending.push(...n.getChildren());
  }
  return [...out];
}

describe('數字（nebula-layout）', () => {
  it('漩渦大圖約 120 秒轉一圈', () => {
    expect(TAU / NEBULA_SPIN).toBeCloseTo(120, 6);
  });

  it('細絲旋臂 2～3 條：速度各不同、都很慢（一圈超過 30 秒）、和大圖也不一樣快', () => {
    expect(NEBULA_FILAMENTS.length).toBeGreaterThanOrEqual(2);
    expect(NEBULA_FILAMENTS.length).toBeLessThanOrEqual(3);
    const speeds = NEBULA_FILAMENTS.map((f) => f.speed);
    expect(new Set(speeds).size).toBe(speeds.length);
    for (const s of speeds) {
      expect(s).toBeGreaterThan(0);
      expect(s).not.toBe(1);
      expect(TAU / (NEBULA_SPIN * s)).toBeGreaterThan(30);
    }
    // 前後層次：在不同的盤面上（中心的深度各不相同），都在卡片後面
    const depths = NEBULA_FILAMENTS.map((f) => f.center.z);
    expect(new Set(depths).size).toBe(depths.length);
    for (const z of depths) expect(z).toBeLessThan(0);
  });

  it('每格：大圖與每條細絲各照自己的速度轉；轉卡越快一起轉快一點；減少動態效果時都不動', () => {
    const m = initialNebulaMotion();
    expect(m.arms.length).toBe(NEBULA_FILAMENTS.length);
    stepNebula(m, 0, 1, false);
    expect(m.spin).toBeCloseTo(NEBULA_SPIN, 12);
    NEBULA_FILAMENTS.forEach((f, i) => expect(m.arms[i]).toBeCloseTo(NEBULA_SPIN * f.speed, 12));
    const busy = initialNebulaMotion();
    stepNebula(busy, 1, 1, false);
    expect(busy.spin).toBeGreaterThan(m.spin);
    busy.arms.forEach((a, i) => expect(a).toBeGreaterThan(m.arms[i]!));
    const before = { spin: m.spin, arms: [...m.arms] };
    stepNebula(m, 1, 5, true);
    expect({ spin: m.spin, arms: [...m.arms] }).toEqual(before);
    // 繞回 0～2π
    const long = initialNebulaMotion();
    for (let i = 0; i < 500; i++) stepNebula(long, 1, 1, false);
    for (const a of [long.spin, ...long.arms]) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(TAU);
    }
  });

  it('大圖的盤面：單位向量互相垂直；在卡片後面；從預設鏡頭看，卡片正中間往後打到圖的暗心（中心壓暗）', () => {
    const f = nebulaSwirlDisc();
    for (const v of [f.normal, f.u, f.v]) expect(len(v)).toBeCloseTo(1, 12);
    expect(dot(f.u, f.v)).toBeCloseTo(0, 12);
    expect(dot(f.u, f.normal)).toBeCloseTo(0, 12);
    expect(f.center.z).toBeLessThan(-2);
    expect(f.center.z).toBeGreaterThan(NEBULA_BACKDROP.z);
    expect(f.normal.z).toBeGreaterThan(0);
    const d = cameraDistance(FOV, 1.6, ZOOM_DEFAULT, cardBox(ASPECT_HEIGHT.standard));
    const cam = { x: 0, y: 0, z: d };
    const ray = { x: 0, y: 0, z: -d };
    const t = dot({ x: f.center.x - cam.x, y: f.center.y - cam.y, z: f.center.z - cam.z }, f.normal) / dot(ray, f.normal);
    const hit = { x: cam.x + ray.x * t - f.center.x, y: cam.y + ray.y * t - f.center.y, z: cam.z + ray.z * t - f.center.z };
    expect(Math.hypot(dot(hit, f.u), dot(hit, f.v))).toBeLessThan(NEBULA_SWIRL.core[1]);
  });

  it('盤面的算法和以前同一個（discFrame）：法線＝ u × v', () => {
    const f = discFrame({ center: { x: 1, y: 2, z: -3 }, tiltDeg: 40, rollDeg: 25 });
    const cross = { x: f.u.y * f.v.z - f.u.z * f.v.y, y: f.u.z * f.v.x - f.u.x * f.v.z, z: f.u.x * f.v.y - f.u.y * f.v.x };
    expect(cross.x).toBeCloseTo(f.normal.x, 12);
    expect(cross.y).toBeCloseTo(f.normal.y, 12);
    expect(cross.z).toBeCloseTo(f.normal.z, 12);
    expect(f.center).toEqual({ x: 1, y: 2, z: -3 });
  });

  it('大圖的 uv：盤面中心＝圖正中、半徑＝圖的邊；轉角 spin 是整張圖繞中心順時針轉（從鏡頭看）', () => {
    expect(nebulaSwirlUv(0, 0, 0)).toEqual({ u: 0.5, v: 0.5 });
    const R = NEBULA_SWIRL.radius;
    const right = nebulaSwirlUv(R, 0, 0);
    expect(right.u).toBeCloseTo(1, 12);
    expect(right.v).toBeCloseTo(0.5, 12);
    const top = nebulaSwirlUv(0, R, 0);
    expect(top.u).toBeCloseTo(0.5, 12);
    expect(top.v).toBeCloseTo(1, 12);
    // 圖上本來在盤面角度 θ 的點，轉了 spin 之後出現在 θ − spin（順時針）
    for (const [theta, spin] of [
      [0.3, 0.5],
      [2, 1.2],
      [-1, 4],
    ] as const) {
      const r = 3;
      const before = nebulaSwirlUv(r * Math.cos(theta), r * Math.sin(theta), 0);
      const after = nebulaSwirlUv(r * Math.cos(theta - spin), r * Math.sin(theta - spin), spin);
      expect(after.u).toBeCloseTo(before.u, 12);
      expect(after.v).toBeCloseTo(before.v, 12);
    }
  });

  it('星點很多、少數金色（藍白最多、金色約一成）', () => {
    const stars = nebulaStars();
    expect(stars.length).toBe(NEBULA_STARS.count);
    expect(stars.length).toBeGreaterThanOrEqual(800);
    const gold = stars.filter((s) => s.tint === 1).length / stars.length;
    const blue = stars.filter((s) => s.tint === 0).length / stars.length;
    expect(gold).toBeGreaterThan(0.06);
    expect(gold).toBeLessThan(0.18);
    expect(Math.abs(gold - NEBULA_STARS.gold)).toBeLessThan(0.03);
    expect(blue).toBeGreaterThan(0.7);
    // 各自不同步：相位與速度都散開
    expect(new Set(stars.map((s) => s.phase.toFixed(3))).size).toBeGreaterThan(stars.length * 0.9);
    expect(new Set(stars.map((s) => s.rate.toFixed(3))).size).toBeGreaterThan(stars.length * 0.5);
  });

  it('光暈多一圈細光環（比原本那圈外、細）；亮一點但仍比卡片暗', () => {
    expect(NEBULA_HALO_RING.radius).toBeGreaterThan(NEBULA_HALO.radius + 0.1);
    expect(NEBULA_HALO_RING.width).toBeLessThan(NEBULA_HALO.width / 2);
    expect(NEBULA_HALO.gain).toBeGreaterThan(0.17); // T-415 是 0.17
    expect(NEBULA_HALO.gain).toBeLessThanOrEqual(0.25);
    expect(NEBULA_HALO_RING.gain).toBeLessThanOrEqual(0.25);
  });

  it('光暈亮度：轉卡越快越亮（能量 0～1 一路變亮、超出範圍夾住）；能量 0＝原本的呼吸', () => {
    for (const t of [0, 1.7, 3.5]) {
      let last = 0;
      for (let e = 0; e <= 1.0001; e += 0.1) {
        const g = nebulaHaloGlow(t, e);
        expect(g).toBeGreaterThan(last);
        last = g;
      }
      expect(nebulaHaloGlow(t, 1)).toBeGreaterThan(nebulaHaloGlow(t, 0) * 1.5);
      expect(nebulaHaloGlow(t, 5)).toBeCloseTo(nebulaHaloGlow(t, 1), 12);
      expect(nebulaHaloGlow(t, -1)).toBeCloseTo(nebulaHaloGlow(t, 0), 12);
    }
  });
});

describe('createNebulaFx：大圖、細絲、光暈', () => {
  it('draw call 照舊 2 個（背景平面、星點）；換上大圖只換背景平面的材質，不多網格', () => {
    const fx = createNebulaFx();
    const count = () => {
      let n = 0;
      fx.group.traverse((o) => {
        if (o instanceof Mesh) n++;
      });
      return n;
    };
    expect(count()).toBe(2);
    fx.setSwirl(swirlOf());
    expect(count()).toBe(2);
  });

  it('setSwirl：換上大圖時背景平面換成畫大圖的材質（舊材質釋放、貼圖不釋放）；同一張再設不換；null 換回程式漩渦', () => {
    const fx = createNebulaFx();
    const mesh = backdropMesh(fx);
    const procedural = mesh.material as Material;
    let freed = 0;
    procedural.addEventListener('dispose', () => freed++);
    expect(textures((procedural as unknown as { colorNode: Node }).colorNode)).toEqual([]);

    const s = swirlOf();
    let texFreed = 0;
    s.texture.addEventListener('dispose', () => texFreed++);
    fx.setSwirl(s);
    const withImage = mesh.material as Material;
    expect(withImage).not.toBe(procedural);
    expect(freed).toBe(1);
    expect(textures((withImage as unknown as { colorNode: Node }).colorNode)).toContain(s.texture);
    // 材質設定照舊（不擋卡片、相加）
    expect(withImage.transparent).toBe(false);
    expect(withImage.depthWrite).toBe(false);
    expect(withImage.depthTest).toBe(false);

    fx.setSwirl(s);
    expect(mesh.material).toBe(withImage);
    fx.setSwirl({ ...s }); // 同一張貼圖（不同物件）也不換
    expect(mesh.material).toBe(withImage);

    let imageFreed = 0;
    withImage.addEventListener('dispose', () => imageFreed++);
    fx.setSwirl(null);
    expect(mesh.material).not.toBe(withImage);
    expect(imageFreed).toBe(1);
    expect(textures((mesh.material as unknown as { colorNode: Node }).colorNode)).toEqual([]);
    expect(texFreed).toBe(0);
    fx.dispose();
    expect(texFreed).toBe(0);
  });

  it('有自己的背景圖（far＝0）：大圖與細絲讓出來；先設背景圖再換上大圖也一樣；拿掉背景圖回來', () => {
    const fx = createNebulaFx();
    fx.setBackdrop({ ...swirlOf('mine') });
    fx.setSwirl(swirlOf());
    expect(fx.uniforms.far.value).toBe(0);
    const mat = backdropMesh(fx).material as unknown as { colorNode: Node; opacityNode: Node };
    // 大圖與細絲都乘上 far：顏色與不透明度都用到它
    expect(uses(mat.colorNode, fx.uniforms.far)).toBe(true);
    expect(uses(mat.opacityNode, fx.uniforms.far)).toBe(true);
    fx.setBackdrop(null);
    expect(fx.uniforms.far.value).toBe(1);
  });

  it('細絲各自的轉角 uniform 都用在畫大圖的材質裡；每格照各自的速度轉', () => {
    const fx = createNebulaFx();
    fx.setSwirl(swirlOf());
    const mat = backdropMesh(fx).material as unknown as { colorNode: Node };
    expect(fx.uniforms.arms.length).toBe(NEBULA_FILAMENTS.length);
    for (const a of fx.uniforms.arms) expect(uses(mat.colorNode, a)).toBe(true);
    expect(uses(mat.colorNode, fx.uniforms.spin)).toBe(true);
    fx.update(0);
    for (let i = 0; i < 60; i++) fx.update(1 / 60);
    const arms = fx.uniforms.arms.map((a) => a.value);
    NEBULA_FILAMENTS.forEach((f, i) => expect(arms[i]).toBeCloseTo(NEBULA_SPIN * f.speed, 6));
    expect(fx.uniforms.spin.value).toBeCloseTo(NEBULA_SPIN, 6);
  });

  it('減少動態效果：連續更新兩次（還拖著卡），大圖、細絲、星星閃爍、光暈的 uniform 都不變', () => {
    const fx = createNebulaFx();
    fx.setSwirl(swirlOf());
    for (let i = 0; i < 30; i++) {
      fx.setPose(i * 12, 0);
      fx.update(1 / 60);
    }
    fx.setReducedMotion(true);
    fx.update(1 / 60);
    const snap = () => [fx.uniforms.spin.value, fx.uniforms.time.value, fx.uniforms.halo.value, ...fx.uniforms.arms.map((a) => a.value)];
    const a = snap();
    fx.setPose(200, 20);
    fx.update(1 / 60);
    fx.setPose(-100, -20);
    fx.update(0.5);
    expect(snap()).toEqual(a);
  });

  it('光暈：轉卡越快越亮（同樣的時間，拖著轉的那個比較亮）', () => {
    const calm = createNebulaFx();
    const busy = createNebulaFx();
    for (let i = 0; i < 40; i++) {
      calm.setPose(0, 0);
      busy.setPose(i * 10, 0); // 每格 10°＝每秒 600°
      calm.update(1 / 60);
      busy.update(1 / 60);
    }
    expect(calm.uniforms.time.value).toBeCloseTo(busy.uniforms.time.value, 9);
    expect(busy.uniforms.halo.value).toBeGreaterThan(calm.uniforms.halo.value * 1.3);
  });

  it('dispose：畫大圖的材質也釋放（貼圖不釋放，歸 card-view）', () => {
    const fx = createNebulaFx();
    const s = swirlOf();
    fx.setSwirl(s);
    const parent = new Group();
    parent.add(fx.group);
    const mat = backdropMesh(fx).material as Material;
    let freed = 0;
    let texFreed = 0;
    mat.addEventListener('dispose', () => freed++);
    s.texture.addEventListener('dispose', () => texFreed++);
    fx.dispose();
    expect(freed).toBe(1);
    expect(texFreed).toBe(0);
    expect(fx.group.parent).toBeNull();
  });
});

describe('stage-switch：大圖只交給星雲', () => {
  type Kind = 'halo' | 'gallery' | 'magic' | 'water' | 'nebula' | 'desk';
  class Part implements NebulaPart {
    group = new Group();
    swirls: (StageBackdrop | null)[] = [];
    calls: string[] = [];
    disposed = false;
    constructor(readonly kind: Kind) {}
    setCardHeight() {}
    setReducedMotion() {}
    setPose() {}
    update() {}
    setBackdrop(b: StageBackdrop | null) {
      this.calls.push(b ? 'backdrop' : 'backdrop-null');
    }
    setSwirl(s: StageBackdrop | null) {
      this.swirls.push(s);
      this.calls.push(s ? 'swirl' : 'swirl-null');
    }
    setThumbs() {}
    setScene() {}
    setFarPan() {}
    setLook() {}
    dispose() {
      this.disposed = true;
    }
  }
  const setup = () => {
    const made: Part[] = [];
    const maker = (kind: Kind) => () => {
      const p = new Part(kind);
      made.push(p);
      return p;
    };
    const sw = createStageSwitch<string>({
      halo: maker('halo'),
      gallery: maker('gallery'),
      magic: maker('magic'),
      water: maker('water'),
      nebula: maker('nebula'),
      desk: maker('desk'),
    });
    return { sw, made };
  };

  it('交給目前的星雲；同一張再設不做事；記住；null 也交', () => {
    const { sw, made } = setup();
    sw.setStyle('nebula');
    const s = swirlOf();
    sw.setNebulaSwirl(s);
    sw.setNebulaSwirl(s);
    expect(made[0]!.swirls).toEqual([s]);
    expect(sw.nebulaSwirl()).toBe(s);
    sw.setNebulaSwirl(null);
    expect(made[0]!.swirls).toEqual([s, null]);
    expect(sw.nebulaSwirl()).toBeNull();
  });

  it('其他舞台收不到大圖（換主題、設大圖都不交給它們）', () => {
    const { sw, made } = setup();
    for (const style of ['halo', 'gallery', 'magic', 'water'] as const) {
      sw.setStyle(style);
      sw.setNebulaSwirl(sw.nebulaSwirl() ? null : swirlOf());
    }
    sw.setStyle('halo');
    for (const p of made) expect(p.swirls).toEqual([]);
  });

  it('換到星雲：新建的星雲一建好就收到記住的大圖（在背景圖之後給）；沒設過就不叫', () => {
    const { sw, made } = setup();
    sw.setStyle('nebula');
    expect(made[0]!.swirls).toEqual([]);
    sw.setStyle('halo');
    const s = swirlOf();
    sw.setNebulaSwirl(s);
    sw.setBackdrop(swirlOf('mine'));
    sw.setStyle('nebula');
    const latest = made.at(-1)!;
    expect(latest.kind).toBe('nebula');
    expect(latest.swirls).toEqual([s]);
    expect(latest.calls).toEqual(['backdrop', 'swirl']);
  });

  it('舊的寫法（沒有 setSwirl 的星雲）照樣能用', () => {
    const plain = (): StagePart => ({
      group: new Group(),
      setCardHeight() {},
      setReducedMotion() {},
      setPose() {},
      update() {},
      dispose() {},
    });
    const sw = createStageSwitch<string>({
      halo: plain,
      gallery: () => ({ ...plain(), setThumbs() {} }),
      magic: plain,
      water: () => ({ ...plain(), setScene() {}, setFarPan() {}, setLook() {} }),
      nebula: plain,
      desk: plain,
    });
    sw.setNebulaSwirl(swirlOf());
    expect(() => sw.setStyle('nebula')).not.toThrow();
  });
});
