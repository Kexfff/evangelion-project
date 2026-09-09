import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import {
  createVRMAnimationClip,
  VRMAnimationLoaderPlugin,
} from "@pixiv/three-vrm-animation";
import { bridge } from "../bridge";
import type { Settings } from "../shared/schema";

export function Avatar({
  avatar,
  settings,
  speaking = false,
  amplitude = 0,
}: {
  avatar: string;
  settings: Settings["vrm"];
  speaking?: boolean;
  amplitude?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ settings, speaking, amplitude });
  live.current = { settings, speaking, amplitude };
  const [status, setStatus] = useState("Loading Eva…");
  const [error, setError] = useState("");
  useEffect(() => {
    const element = host.current!;
    let disposed = false,
      frame = 0,
      vrm: VRM | undefined,
      mixer: THREE.AnimationMixer | undefined;
    let currentAction: THREE.AnimationAction | undefined,
      animationName = "",
      animationVersion = 0;
    const clips = new Map<string, THREE.AnimationClip>();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(29, 1, 0.05, 100);
    let renderer: THREE.WebGLRenderer;
    setError("");
    setStatus("Loading avatar…");
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      setError(
        "WebGL is unavailable. Enable GPU acceleration to render the avatar.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    element.appendChild(renderer.domElement);
    const ambient = new THREE.HemisphereLight(0xe9e4ff, 0x727384, 2.2);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xfff3ef, 2);
    key.position.set(1, 2, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xb7a1ff, 2);
    rim.position.set(-2, 1, -1);
    scene.add(rim);
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const animationLoader = new GLTFLoader();
    animationLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    let height = 1.7,
      centerY = 0.85;
    async function play(name: string) {
      const version = ++animationVersion;
      element.dataset.animation = "";
      try {
        let clip = clips.get(name);
        if (!clip) {
          const gltf = await animationLoader.loadAsync(
            bridge.assetUrl(`animation:${name}`),
          );
          if (disposed || !vrm) return;
          const animation = gltf.userData.vrmAnimations?.[0];
          if (!animation)
            throw new Error("Animation contains no VRM animation data");
          clip = createVRMAnimationClip(animation, vrm);
          clips.set(name, clip);
        }
        if (disposed || version !== animationVersion || !mixer) return;
        const action = mixer.clipAction(clip);
        action.reset();
        action.setLoop(THREE.LoopRepeat, Infinity);
        currentAction?.fadeOut(0.3);
        action.fadeIn(0.3).play();
        currentAction = action;
        element.dataset.animation = name;
        setStatus("");
      } catch {
        if (!disposed) {
          setStatus("");
          setError(
            `Could not load ${name}. Try another animation in settings.`,
          );
        }
      }
    }
    void loader
      .loadAsync(bridge.assetUrl(avatar), (progress) => {
        if (!disposed && progress.total)
          setStatus(
            `Loading avatar · ${Math.round((progress.loaded / progress.total) * 100)}%`,
          );
      })
      .then((gltf) => {
        const loaded = gltf.userData.vrm as VRM | undefined;
        if (disposed) {
          VRMUtils.deepDispose(gltf.scene);
          return;
        }
        if (!loaded) {
          VRMUtils.deepDispose(gltf.scene);
          throw new Error("The file is not a supported VRM avatar.");
        }
        vrm = loaded;
        VRMUtils.rotateVRM0(vrm);
        vrm.scene.traverse((object) => {
          object.frustumCulled = false;
        });
        scene.add(vrm.scene);
        const box = new THREE.Box3().setFromObject(vrm.scene);
        height = box.max.y - box.min.y;
        centerY = (box.max.y + box.min.y) / 2;
        mixer = new THREE.AnimationMixer(vrm.scene);
        setStatus("Loading motion…");
        animationName = live.current.settings.animation;
        void play(animationName);
      })
      .catch((err) => {
        if (!disposed) {
          setStatus("");
          setError(
            err instanceof Error ? err.message : "Avatar failed to load",
          );
        }
      });
    const resize = new ResizeObserver(() => {
      const width = element.clientWidth,
        h = element.clientHeight;
      if (!width || !h) return;
      renderer.setSize(width, h);
      camera.aspect = width / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(element);
    const clock = new THREE.Clock();
    let elapsed = 0,
      nextBlink = 2.4,
      blinkStart = -1;
    const animate = () => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      elapsed += dt;
      const { settings: s, speaking: talking, amplitude: level } = live.current;
      key.color.set(s.lightColor);
      key.intensity = s.lightIntensity;
      const distance =
        ((height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) *
          1.13) /
        s.zoom;
      camera.position.set(0, centerY, distance);
      camera.lookAt(0, centerY, 0);
      if (vrm) {
        vrm.scene.position.set(s.x, s.y, 0);
        vrm.scene.rotation.y =
          THREE.MathUtils.degToRad(s.rotation) +
          (vrm.meta.metaVersion === "0" ? Math.PI : 0);
        if (animationName !== s.animation) {
          animationName = s.animation;
          setError("");
          void play(animationName);
        }
        mixer?.update(dt);
        if (elapsed >= nextBlink) {
          blinkStart = elapsed;
          nextBlink = elapsed + 2.5 + Math.random() * 3;
        }
        const blink =
          s.autoBlink && blinkStart >= 0
            ? Math.max(0, Math.sin(((elapsed - blinkStart) / 0.16) * Math.PI))
            : 0;
        if (elapsed - blinkStart > 0.16) blinkStart = -1;
        vrm.expressionManager?.setValue("blink", blink);
        vrm.expressionManager?.setValue(
          "aa",
          talking ? Math.min(1, level * 4) : 0,
        );
        vrm.update(dt);
      }
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      mixer?.stopAllAction();
      if (vrm) {
        mixer?.uncacheRoot(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
      }
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [avatar]);
  return (
    <div
      className="avatar-renderer"
      ref={host}
      aria-label="Animated VRM avatar"
    >
      {status && !error && (
        <div className="avatar-notice">
          <span className="loading-ring" />
          {status}
        </div>
      )}
      {error && (
        <div className="avatar-notice error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
