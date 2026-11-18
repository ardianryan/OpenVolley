import * as THREE from 'three';

export interface VolleyballTextureSet {
  colorMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

/**
 * Generates an authentic 18-panel spherical volleyball texture + inflated leather bump map.
 * Uses 3D spherical cube-face projection (x -> y -> z cyclic strip orientation) so there is
 * zero UV pinching at the poles and authentic 3-panel orthogonal T-junctions from every 3D angle.
 */
export function createVolleyballTextures(width = 1024, height = 512): VolleyballTextureSet {
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = width;
  colorCanvas.height = height;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = width;
  bumpCanvas.height = height;

  const cCtx = colorCanvas.getContext('2d');
  const bCtx = bumpCanvas.getContext('2d');

  if (cCtx && bCtx) {
    const colorImg = cCtx.createImageData(width, height);
    const bumpImg = bCtx.createImageData(width, height);
    const cData = colorImg.data;
    const bData = bumpImg.data;

    // Official SVC Sport Palette: Pearl White, Champagne Gold, Deep Sport Navy
    const PALETTE = {
      white: [248, 250, 252],
      gold: [245, 197, 56],
      richGold: [232, 168, 28],
      navy: [24, 43, 78],
      seam: [15, 23, 42],
    } as const;

    for (let py = 0; py < height; py++) {
      const v = (py + 0.5) / height;
      const phi = v * Math.PI; // 0 (north pole) -> PI (south pole)
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      for (let px = 0; px < width; px++) {
        const u = (px + 0.5) / width;
        const theta = u * Math.PI * 2 - Math.PI;

        // Point on unit sphere with a gentle Mikasa-inspired aerodynamic curve twist
        const rawX = sinPhi * Math.cos(theta);
        const rawY = cosPhi;
        const rawZ = sinPhi * Math.sin(theta);

        const twist = 0.22 * rawY;
        const cosT = Math.cos(twist);
        const sinT = Math.sin(twist);
        const x = rawX * cosT - rawZ * sinT;
        const y = rawY;
        const z = rawX * sinT + rawZ * cosT;

        const ax = Math.abs(x);
        const ay = Math.abs(y);
        const az = Math.abs(z);

        // Determine dominant cube face & cyclic strip axis (18-panel volleyball topology)
        let dom = ax;
        let sec = Math.max(ay, az);
        let stripCoord = 0; // in [-1, 1]
        let alongCoord = 0; // in [-1, 1]
        let faceGroup = 0; // 0: X-faces, 1: Y-faces, 2: Z-faces

        if (ax >= ay && ax >= az) {
          dom = ax;
          sec = Math.max(ay, az);
          stripCoord = y / ax;
          alongCoord = z / ax;
          faceGroup = 0;
        } else if (ay >= ax && ay >= az) {
          dom = ay;
          sec = Math.max(ax, az);
          stripCoord = z / ay;
          alongCoord = x / ay;
          faceGroup = 1;
        } else {
          dom = az;
          sec = Math.max(ax, ay);
          stripCoord = x / az;
          alongCoord = y / az;
          faceGroup = 2;
        }

        // Subtle S-curve wave inside each face for dynamic pro-volleyball styling
        const curvedStrip = stripCoord + 0.08 * Math.sin(alongCoord * Math.PI * 0.5);

        // Distance to outer face boundary (0 at cube-sphere edge)
        const faceEdgeDist = (dom - sec) / dom;
        // Distance to inner 3-strip boundaries at -1/3 and +1/3
        const stripEdgeDist = Math.min(
          Math.abs(curvedStrip - 0.3333),
          Math.abs(curvedStrip + 0.3333)
        );

        const seamDist = Math.min(faceEdgeDist * 0.95, stripEdgeDist * 0.85);

        // Which of the 3 strips inside this face (-1, 0, +1)
        const stripIdx = curvedStrip < -0.3333 ? 0 : curvedStrip > 0.3333 ? 2 : 1;

        // Assign balanced pro volleyball panel colors
        let baseRgb: readonly [number, number, number] = PALETTE.white;
        if (faceGroup === 0) {
          baseRgb = stripIdx === 1 ? PALETTE.white : PALETTE.gold;
        } else if (faceGroup === 1) {
          baseRgb = stripIdx === 1 ? PALETTE.navy : PALETTE.white;
        } else {
          baseRgb = stripIdx === 1 ? PALETTE.richGold : PALETTE.navy;
        }

        // Recessed stitched seam groove + inflated leather panel cushion bevel
        const grooveHalfWidth = 0.022;
        const bevelWidth = 0.095;
        let seamMix = 0;
        let cushionHeight = 1.0;

        if (seamDist < grooveHalfWidth) {
          const t = seamDist / grooveHalfWidth;
          seamMix = 1 - t * t * 0.35;
          cushionHeight = 0.08 + 0.3 * t;
        } else if (seamDist < bevelWidth) {
          const t = (seamDist - grooveHalfWidth) / (bevelWidth - grooveHalfWidth);
          seamMix = (1 - t) * 0.18;
          // Smooth rounded pillow bevel near stitches
          cushionHeight = 0.38 + 0.62 * (1 - Math.pow(1 - t, 2.4));
        }

        // Subtle micro-dimple leather grain (high-frequency spherical hash)
        const dimple =
          Math.sin(x * 150) * Math.sin(y * 150) * Math.sin(z * 150) * 0.06;

        const r = Math.round(
          baseRgb[0] * (1 - seamMix) + PALETTE.seam[0] * seamMix
        );
        const g = Math.round(
          baseRgb[1] * (1 - seamMix) + PALETTE.seam[1] * seamMix
        );
        const b = Math.round(
          baseRgb[2] * (1 - seamMix) + PALETTE.seam[2] * seamMix
        );

        const idx = (py * width + px) * 4;
        cData[idx] = r;
        cData[idx + 1] = g;
        cData[idx + 2] = b;
        cData[idx + 3] = 255;

        const bumpVal = Math.max(
          0,
          Math.min(255, Math.round((cushionHeight + dimple) * 235))
        );
        bData[idx] = bumpVal;
        bData[idx + 1] = bumpVal;
        bData[idx + 2] = bumpVal;
        bData[idx + 3] = 255;
      }
    }

    cCtx.putImageData(colorImg, 0, 0);
    bCtx.putImageData(bumpImg, 0, 0);
  }

  const colorMap = new THREE.CanvasTexture(colorCanvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.wrapS = THREE.RepeatWrapping;
  colorMap.wrapT = THREE.ClampToEdgeWrapping;
  colorMap.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.ClampToEdgeWrapping;

  return { colorMap, bumpMap };
}

export interface OffscreenVolleyballController {
  canvas: HTMLCanvasElement;
  render: (opts: {
    rx: number;
    ry: number;
    rz: number;
    lightAngle?: number;
    camOffsetX?: number;
    camOffsetY?: number;
    camZ?: number;
  }) => HTMLCanvasElement;
  dispose: () => void;
}

/**
 * Creates a dedicated transparent WebGL 3D Volleyball studio renderer for compositing
 * natural, non-stiff 3D spinning volleyballs with real lighting & parallax onto 2D broadcast canvases.
 */
export function createOffscreenVolleyball3D(size = 512): OffscreenVolleyballController | null {
  try {
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(size, size, false);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
    camera.position.set(0, 0, 3.85);
    camera.lookAt(0, 0, 0);

    // 3-Point Stadium Broadcast Lighting
    const ambient = new THREE.AmbientLight(0xfffbeb, 0.85);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
    keyLight.position.set(-2.8, 3.4, 4.2);
    scene.add(keyLight);

    const goldRim = new THREE.DirectionalLight(0xf5c538, 1.45);
    goldRim.position.set(3.6, -1.8, -2.0);
    scene.add(goldRim);

    const skyFill = new THREE.DirectionalLight(0xbae6fd, 0.75);
    skyFill.position.set(2.2, 2.8, 2.5);
    scene.add(skyFill);

    const textures = createVolleyballTextures(1024, 512);
    const geo = new THREE.SphereGeometry(1, 64, 48);
    const mat = new THREE.MeshStandardMaterial({
      map: textures.colorMap,
      bumpMap: textures.bumpMap,
      bumpScale: 0.038,
      roughness: 0.34,
      metalness: 0.06,
    });

    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    return {
      canvas: renderer.domElement,
      render: ({
        rx,
        ry,
        rz,
        lightAngle = 0,
        camOffsetX = 0,
        camOffsetY = 0,
        camZ = 3.85,
      }) => {
        mesh.rotation.set(rx, ry, rz);
        camera.position.set(camOffsetX, camOffsetY, camZ);
        camera.lookAt(0, 0, 0);
        if (lightAngle !== 0) {
          keyLight.position.set(
            -2.8 * Math.cos(lightAngle) - 1.2 * Math.sin(lightAngle),
            3.4,
            4.2
          );
        }
        renderer.render(scene, camera);
        return renderer.domElement;
      },
      dispose: () => {
        geo.dispose();
        mat.dispose();
        textures.colorMap.dispose();
        textures.bumpMap.dispose();
        renderer.dispose();
      },
    };
  } catch {
    return null;
  }
}
