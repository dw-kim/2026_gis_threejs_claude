import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// 마우스 오버 시 대상 오브젝트에 파란색 테두리(OutlinePass)를 씌워주는 헬퍼.
//
// 주의: 이 프로젝트는 MapLibre 커스텀 레이어 여러 개가 캔버스 하나를 공유하며
// 각자 renderer.render()를 직접 호출하는 구조라, OutlinePass를 보통 예제처럼
// (RenderPass -> OutlinePass -> renderToScreen) 화면에 바로 그리면 그 순간 캔버스
// 전체가 덮어써져서 지도와 다른 모델이 사라진다. 그래서 OutlinePass는 화면에
// 직접 그리지 않고(readBuffer에만 additive로 누적) 우리가 직접 그 결과를
// "덧셈 블렌딩"으로만 화면 위에 얹는다. 이러면 테두리 색만 더해지고 나머지
// 화면(지도, 다른 모델)은 그대로 보존된다.
export default class HoverOutline {
    constructor(map, renderer, scene, camera, { color = 0x2196f3 } = {}) {
        this.map = map;
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.hoverTargets = [];

        // OutlinePass는 가려짐 판정을 위해 camera.near/far로 깊이값을 선형화한다.
        // 이 프로젝트의 camera는 매 프레임 투영행렬만 직접 덮어쓰는 순수 THREE.Camera라
        // near/far가 원래 undefined이고, 그러면 내부 셰이더 계산이 NaN이 되어
        // 화면 위치(깊이)에 따라 외곽선이 들쭉날쭉하게 나온다. 임의의 유효한 범위를 넣어준다.
        if (camera.near === undefined) camera.near = 0.1;
        if (camera.far === undefined) camera.far = 1e7;

        const canvas = map.getCanvas();
        const size = new THREE.Vector2(canvas.width || 1, canvas.height || 1);

        this.composer = new EffectComposer(renderer);
        this.composer.renderToScreen = false;

        this.outlinePass = new OutlinePass(size, scene, camera);
        this.outlinePass.edgeStrength = 6;
        this.outlinePass.edgeGlow = 0.7;
        this.outlinePass.edgeThickness = 2;
        this.outlinePass.pulsePeriod = 0;
        this.outlinePass.visibleEdgeColor.set(color);
        this.outlinePass.hiddenEdgeColor.set(color);
        this.outlinePass.selectedObjects = [];
        this.composer.addPass(this.outlinePass);

        // readBuffer(테두리가 additive로 누적된 결과)를 화면에 "더하기"만 하는 블릿 패스
        this.blitMaterial = new THREE.ShaderMaterial({
            uniforms: { tDiffuse: { value: null } },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                varying vec2 vUv;
                void main() {
                    gl_FragColor = texture2D(tDiffuse, vUv);
                }
            `,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            depthWrite: false,
            transparent: true
        });
        this.blitQuad = new FullScreenQuad(this.blitMaterial);

        this.raycaster = new THREE.Raycaster();
        this.pointerNDC = new THREE.Vector2(-Infinity, -Infinity);
        this.lastWidth = size.x;
        this.lastHeight = size.y;

        this.onPointerMove = (e) => {
            const rect = canvas.getBoundingClientRect();
            this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        };
        this.onPointerLeave = () => {
            this.pointerNDC.set(-Infinity, -Infinity);
        };

        canvas.addEventListener('mousemove', this.onPointerMove);
        canvas.addEventListener('mouseleave', this.onPointerLeave);
    }

    // 레이캐스트 대상이 될 오브젝트 목록 (매 프레임 바뀌어도 됨)
    setTargets(objects) {
        this.hoverTargets = objects;
    }

    // 현재 마우스 아래에서 가장 가까운 교차 결과(intersection) 또는 null
    pickHover() {
        if (this.hoverTargets.length === 0) return null;
        if (!Number.isFinite(this.pointerNDC.x) || !Number.isFinite(this.pointerNDC.y)) return null;

        // camera.projectionMatrix을 직접 덮어써서 쓰고 있어 updateProjectionMatrix()가
        // 호출되지 않고, camera가 THREE.Camera 베이스 클래스라 isPerspectiveCamera 등의
        // 표식이 없어 raycaster.setFromCamera()가 "Unsupported camera type"으로 거부한다.
        // 그래서 NDC 좌표를 역투영행렬로 직접 풀어 ray를 만든다.
        this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

        const near = new THREE.Vector3(this.pointerNDC.x, this.pointerNDC.y, -1)
            .applyMatrix4(this.camera.projectionMatrixInverse)
            .applyMatrix4(this.camera.matrixWorld);
        const far = new THREE.Vector3(this.pointerNDC.x, this.pointerNDC.y, 1)
            .applyMatrix4(this.camera.projectionMatrixInverse)
            .applyMatrix4(this.camera.matrixWorld);

        this.raycaster.ray.origin.copy(near);
        this.raycaster.ray.direction.copy(far).sub(near).normalize();

        const intersects = this.raycaster.intersectObjects(this.hoverTargets, true);
        return intersects.length > 0 ? intersects[0] : null;
    }

    setSelected(object) {
        this.outlinePass.selectedObjects = object ? [object] : [];
    }

    render() {
        const canvas = this.map.getCanvas();
        const width = canvas.width || 1;
        const height = canvas.height || 1;

        if (width !== this.lastWidth || height !== this.lastHeight) {
            this.composer.setSize(width, height);
            this.outlinePass.resolution.set(width, height);
            this.lastWidth = width;
            this.lastHeight = height;
        }

        // 이전 프레임 잔상이 additive로 계속 쌓이지 않도록 매 프레임 비운다.
        this.renderer.setRenderTarget(this.composer.readBuffer);
        this.renderer.clear(true, true, true);
        this.renderer.setRenderTarget(this.composer.writeBuffer);
        this.renderer.clear(true, true, true);
        this.renderer.setRenderTarget(null);

        this.composer.render();

        // OutlinePass 결과(readBuffer)를 화면에 "더하기"만 해서 얹는다.
        this.blitMaterial.uniforms.tDiffuse.value = this.composer.readBuffer.texture;
        this.renderer.setRenderTarget(null);
        this.blitQuad.render(this.renderer);
    }

    remove() {
        const canvas = this.map.getCanvas();
        canvas.removeEventListener('mousemove', this.onPointerMove);
        canvas.removeEventListener('mouseleave', this.onPointerLeave);
    }
}
