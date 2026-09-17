import * as THREE from "three";

export function initSpine3D() {
  const mount = document.querySelector("[data-spine-mount]");
  const canvas = document.querySelector("[data-spine-canvas]");
  if (!mount || !canvas) return;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 9);

  const ambient = new THREE.AmbientLight(0xdfe6d4, 0.55);
  const key = new THREE.DirectionalLight(0xf4f2ea, 1.1);
  key.position.set(3, 4, 5);
  const fill = new THREE.DirectionalLight(0x93a583, 0.6);
  fill.position.set(-4, -2, 3);
  scene.add(ambient, key, fill);

  const spineGroup = new THREE.Group();
  scene.add(spineGroup);

  const VERTEBRAE_COUNT = 22;
  const material = new THREE.MeshStandardMaterial({
    color: 0xc7d3b9,
    roughness: 0.55,
    metalness: 0.08,
    emissive: 0x1a2015,
    emissiveIntensity: 0.4,
  });
  const discMaterial = new THREE.MeshStandardMaterial({
    color: 0x93a583,
    roughness: 0.7,
    metalness: 0.05,
  });

  for (let i = 0; i < VERTEBRAE_COUNT; i++) {
    const t = i / (VERTEBRAE_COUNT - 1);
    const y = lerp(3.6, -3.6, t);
    const curveX = Math.sin(t * Math.PI) * 0.65;

    const vertebra = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, 0.05, 4, 12),
      material
    );
    vertebra.position.set(curveX, y, 0);
    vertebra.rotation.z = Math.PI / 2;
    spineGroup.add(vertebra);

    if (i < VERTEBRAE_COUNT - 1) {
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.24, 0.12, 16),
        discMaterial
      );
      const nextT = (i + 1) / (VERTEBRAE_COUNT - 1);
      const nextY = lerp(3.6, -3.6, nextT);
      const nextX = Math.sin(nextT * Math.PI) * 0.65;
      disc.position.set((curveX + nextX) / 2, (y + nextY) / 2, 0);
      disc.rotation.z = Math.PI / 2;
      spineGroup.add(disc);
    }
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function resize() {
    const rect = mount.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(mount);
  resize();

  let visible = true;
  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
    },
    { threshold: 0.05 }
  );
  io.observe(mount);

  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    if (!visible) return;
    const delta = clock.getDelta();
    spineGroup.rotation.y += delta * 0.22;
    spineGroup.rotation.x = Math.sin(clock.elapsedTime * 0.2) * 0.08;
    renderer.render(scene, camera);
  }
  animate();
}
