'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PAGE_HEIGHT, PAGE_WIDTH } from '@/lib/album/bookModel';
import { MODE_SINGLE, sidesOfSpread } from '@/lib/album/pageModel';
import { MIN_GRAB_U } from '@/lib/album/turnController';

/** Pixels of movement that turn a press into a drag. */
const DRAG_START_PX = 6;
/** Outer fraction of a page treated as its "edge", for clicks and hover. */
const EDGE_ZONE = 0.3;
/** Touch targets on a small page need more room than a mouse pointer does. */
const EDGE_ZONE_TOUCH = 0.42;
const SPEED_WINDOW_MS = 90;
/** How far a swipe goes, in page widths, before a returning page is under the finger. */
const CATCH_UP_TRAVEL = 0.32;

/**
 * Turns raw pointer events on the canvas into book actions. Works in screen
 * coordinates converted to the book's plane rather than through mesh raycasting:
 * the camera is straight on, so this is exact and costs nothing, and a drag keeps
 * working when the pointer leaves the page or the canvas.
 */
export function usePageTurn(controller, onPhotoTap, leafContext) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const coverPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const coverHit = new THREE.Vector3();
    let press = null;
    let lastSamples = [];

    // The page-turning maths works from the camera's straight-on framing. The pointer's
    // slight swing of the view is ignored here, as it moves things by only a few pixels.
    const cameraZ = () => camera.userData.baseZ ?? camera.position.z;
    const cameraY = () => camera.userData.baseY ?? camera.position.y;

    /** Pointer position on the z = 0 plane, in world units. */
    const toPlane = (event) => {
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = 1 - ((event.clientY - rect.top) / rect.height) * 2;
      const halfH = cameraZ() * Math.tan((camera.fov * Math.PI) / 360);
      return { x: ndcX * halfH * camera.aspect, y: cameraY() + ndcY * halfH };
    };

    /** Pulls a plane position up to the height of the open pages, for hit testing. */
    const toPageSurface = ({ x, y }) => {
      const { layout } = controller;
      const pageZ = layout.boardT + layout.blockT / 2;
      const k = (cameraZ() - pageZ) / cameraZ();
      return { x: x * k, y: cameraY() + (y - cameraY()) * k };
    };

    /**
     * A closed book is seen at a steep angle, where the straight-on maths would be well
     * off. So the pointer's real ray through the camera is followed to the cover.
     */
    const isOverClosedBook = (event) => {
      const { layout, pose } = controller;
      const rect = canvas.getBoundingClientRect();
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
      raycaster.setFromCamera(ndc, camera);
      // Hanging in the air it could be at any angle, so it's judged by how far it can reach.
      const { spin } = controller;
      if (spin.isRotated) {
        const halfZ = layout.boardT + layout.blockT / 2;
        coverHit.set(0, 0, spin.centreHeight(layout.closedWidth / 2, layout.bookHeight / 2, halfZ));
        return raycaster.ray.distanceToPoint(coverHit) < Math.hypot(layout.closedWidth, layout.bookHeight) * 0.46;
      }
      coverPlane.constant = -(layout.boardT * 2 + layout.blockT);
      if (!raycaster.ray.intersectPlane(coverPlane, coverHit)) return false;
      const halfW = layout.closedWidth / 2;
      // The block is drawn half a page either side of the middle of the view when shut.
      const centre = pose.offsetX + Math.sign(-pose.offsetX) * halfW;
      return Math.abs(coverHit.x - centre) < halfW * 1.04 && Math.abs(coverHit.y) < layout.bookHeight / 2;
    };

    /** Which page a position falls on, or null if outside the book. */
    const hitPage = (surface) => {
      const bookX = surface.x - controller.pose.offsetX;
      const v = surface.y / PAGE_HEIGHT;
      if (Math.abs(v) > 0.52) return null;
      if (controller.mode === MODE_SINGLE) {
        // The only page in view is the right-hand one. Its margin at the screen edge
        // still counts, because a thumb often starts there.
        const u = bookX / PAGE_WIDTH;
        if (u > 1.1) return null;
        return { side: 1, u: Math.max(0, Math.min(1, u)), v: Math.max(-0.5, Math.min(0.5, v)) };
      }
      const side = bookX >= 0 ? 1 : -1;
      const u = Math.abs(bookX) / PAGE_WIDTH;
      if (u > 1.03) return null;
      return { side, u: Math.min(1, u), v: Math.max(-0.5, Math.min(0.5, v)) };
    };

    const photoOnHit = (hit) => {
      const { spread, mode } = controller;
      const { left, right } = sidesOfSpread(spread, controller.layout.leafCount, mode);
      return leafContext.current.photoOnSide(hit.side > 0 ? right : left);
    };

    const onPointerDown = (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const plane = toPlane(event);
      const surface = toPageSurface(plane);
      press = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        hit: controller.isCoverOpen ? hitPage(surface) : null,
        overCover: !controller.isCoverOpen && isOverClosedBook(event),
        spinning: false,
        lastX: event.clientX,
        lastY: event.clientY,
        touch: event.pointerType !== 'mouse',
        dragging: false,
        plane,
        // Set when a drag starts: which way it maps from the pointer to the sheet.
        correction: 0,
        fromOffscreen: false,
      };
      lastSamples = [{ time: event.timeStamp, x: plane.x }];
      if (press.hit || press.overCover) {
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {
          // The pointer is already gone; pointerup/cancel will still end the press.
        }
      }
    };

    const updateHover = (event) => {
      if (event.pointerType !== 'mouse') return;
      const surface = toPageSurface(toPlane(event));
      if (!controller.isCoverOpen) {
        controller.clearPeek();
        canvas.style.cursor = isOverClosedBook(event) ? 'grab' : '';
        return;
      }
      const hit = hitPage(surface);
      const leaf = hit ? controller.grabbableLeaf(hit.side) : null;
      if (hit && leaf !== null && hit.u > 1 - EDGE_ZONE) {
        controller.setPeek(leaf, hit.v);
        canvas.style.cursor = 'grab';
        return;
      }
      controller.clearPeek();
      if (hit && photoOnHit(hit)) canvas.style.cursor = 'zoom-in';
      else canvas.style.cursor = hit && leaf !== null ? 'grab' : '';
    };

    /**
     * Starts a drag from a press that has moved far enough, or abandons the press.
     *
     * On a spread, the side you press decides the sheet. On a single page there is
     * only one side, so the direction of the swipe decides instead: leftward lifts
     * this page, rightward brings the previous page back.
     */
    const startDrag = (event) => {
      const dx = event.clientX - press.startX;
      const dy = event.clientY - press.startY;
      const { hit } = press;
      const single = controller.mode === MODE_SINGLE;
      if (single && Math.abs(dx) < Math.abs(dy)) {
        press.hit = null; // an up-and-down gesture isn't a page turn
        return;
      }
      const side = single ? (dx < 0 ? 1 : -1) : hit.side;
      const leaf = controller.grabbableLeaf(side);
      if (leaf === null) {
        press.hit = null;
        return;
      }

      const offset = controller.pose.offsetX;
      if (single && side < 0) {
        // The previous page lies off-screen with its edge a whole page beyond reach,
        // so it can't start under the finger. See fromOffscreenTarget below.
        press.fromOffscreen = true;
        press.dragging = controller.beginDrag(leaf, 1, hit.v, press.plane.y);
      } else {
        // When pressed close to the spine the held point is moved outward. Keeping the
        // difference as a constant offset stops the sheet jumping at the first move.
        const grabU = Math.max(hit.u, MIN_GRAB_U);
        press.correction = side * grabU * PAGE_WIDTH + offset - press.plane.x;
        press.dragging = controller.beginDrag(leaf, grabU, hit.v, press.plane.y);
      }
      if (press.dragging) canvas.style.cursor = 'grabbing';
    };

    /**
     * Where the previous page's fore-edge should be for a given swipe. The edge starts
     * a whole page off-screen, so it can't begin under the finger. Over the first part
     * of the swipe it swings across to catch up, and from then on it is under the
     * finger, exactly as when lifting a page. A steady mapping would leave the page out
     * of sight for half the swipe, with only its shadow to show that anything happened.
     */
    const fromOffscreenTarget = (planeX) => {
      const travel = Math.max(0, planeX - press.plane.x) / (PAGE_WIDTH * CATCH_UP_TRAVEL);
      const k = Math.min(1, travel);
      const eased = k * k * (3 - 2 * k);
      const hidden = -PAGE_WIDTH + controller.pose.offsetX;
      return hidden + (planeX - hidden) * eased;
    };

    const onPointerMove = (event) => {
      if (!press) {
        updateHover(event);
        return;
      }
      if (event.pointerId !== press.id) return;

      // Dragging a closed book turns it over. A press that doesn't move still opens it.
      if (press.overCover) {
        if (!press.spinning) {
          const moved = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
          if (moved < DRAG_START_PX) return;
          press.spinning = true;
          controller.spin.grab();
          canvas.style.cursor = 'grabbing';
        }
        controller.spin.dragBy(event.clientX - press.lastX, event.clientY - press.lastY);
        press.lastX = event.clientX;
        press.lastY = event.clientY;
        controller.wake();
        return;
      }

      const plane = toPlane(event);
      lastSamples.push({ time: event.timeStamp, x: plane.x });
      while (lastSamples.length > 2 && event.timeStamp - lastSamples[0].time > SPEED_WINDOW_MS) {
        lastSamples.shift();
      }

      if (!press.dragging && press.hit) {
        const moved = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
        if (moved < DRAG_START_PX) return;
        startDrag(event);
      }
      if (press.dragging) {
        const target = press.fromOffscreen ? fromOffscreenTarget(plane.x) : plane.x + press.correction;
        controller.dragTo(target, plane.y, cameraZ());
      }
    };

    const pointerSpeed = (now) => {
      if (lastSamples.length < 2) return 0;
      const first = lastSamples[0];
      const last = lastSamples[lastSamples.length - 1];
      // A pause before letting go is a placement, not a flick, whatever came before it.
      if (now - last.time > SPEED_WINDOW_MS) return 0;
      const dt = (last.time - first.time) / 1000;
      return dt > 0.005 ? (last.x - first.x) / dt : 0;
    };

    /** What a tap does on a single page: its two edges turn, its middle opens the photo. */
    const tapSinglePage = (hit) => {
      if (hit.u < EDGE_ZONE) {
        controller.prev();
        return;
      }
      const photo = photoOnHit(hit);
      if (photo && hit.u <= 1 - EDGE_ZONE) onPhotoTap(photo);
      else controller.next();
    };

    const onPointerUp = (event) => {
      if (!press || event.pointerId !== press.id) return;
      const current = press;
      press = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);

      if (current.dragging) {
        controller.endDrag(pointerSpeed(event.timeStamp));
        canvas.style.cursor = '';
        return;
      }
      if (current.spinning) {
        controller.spin.release();
        controller.wake();
        canvas.style.cursor = 'grab';
        return;
      }
      if (current.overCover) {
        const { stage } = controller.getSnapshot();
        if (stage === 'closed-front') controller.next();
        else if (stage === 'closed-back') controller.prev();
        return;
      }
      if (!current.hit) return;

      if (controller.mode === MODE_SINGLE) {
        tapSinglePage(current.hit);
        return;
      }

      // A tap: page edges turn, photographs open, and elsewhere on a blank page turns.
      const { hit } = current;
      const edge = current.touch ? EDGE_ZONE_TOUCH : EDGE_ZONE;
      const photo = photoOnHit(hit);
      if (photo && hit.u <= 1 - edge) {
        onPhotoTap(photo);
        return;
      }
      if (controller.grabbableLeaf(hit.side) === null) return;
      if (hit.side > 0) controller.next();
      else controller.prev();
    };

    const onPointerCancel = (event) => {
      if (!press || event.pointerId !== press.id) return;
      if (press.dragging) controller.endDrag(0);
      if (press.spinning) controller.spin.release();
      press = null;
    };

    const onPointerLeave = () => {
      if (!press) {
        controller.clearPeek();
        canvas.style.cursor = '';
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', onPointerLeave);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [gl, camera, controller, onPhotoTap, leafContext]);
}
