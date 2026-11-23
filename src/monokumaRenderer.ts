import idleUrl from './assets/monokuma/idle.png';
import privacyUrl from './assets/monokuma/privacy.png';
import type { DaFeiYuLayout } from './dafeiyuRenderer';

export type MonokumaLayout = DaFeiYuLayout;

interface PawState {
  x: number;
  y: number;
  tx: number;
  ty: number;
  lastAt: number;
  squash: number;
  heldVks: Set<number>;
}

interface ImpactRing {
  x: number;
  y: number;
  r: number;
  life: number;
}

interface FloatingSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

const DESPAIR_RED = '#E60012';
const DESPAIR_RED_DARK = '#99000C';

/**
 * Danganronpa Monokuma (弹丸论破 黑白熊) standalone sprite companion renderer for KuroCat.
 * Uses transparent PNG sprites under `src/assets/monokuma/` (idle & eye-covering privacy state),
 * procedural white left round bear paw & black right round bear paw that land accurately on
 * each struck keycap, crimson (#E60012) Danganronpa hit accents, and full 65%/108-key + mouse support.
 */
export class MonokumaRenderer {
  private sprites: Record<'idle' | 'privacy', HTMLImageElement>;

  private lastKeyAt = -10000;
  private bodyShiftX = 0;
  private bodyShiftVel = 0;
  private bodyShiftTarget = 0;
  private bodyTilt = 0;
  private bodyTiltVel = 0;
  private bodyTiltTarget = 0;
  private bodyDiveY = 0;
  private bodyBob = 0;
  private lastSpacePaw: 'left' | 'right' = 'left';

  private leftPaw: PawState = {
    x: 152,
    y: 312,
    tx: 152,
    ty: 312,
    lastAt: -10000,
    squash: 0,
    heldVks: new Set(),
  };

  private rightPaw: PawState = {
    x: 236,
    y: 312,
    tx: 236,
    ty: 312,
    lastAt: -10000,
    squash: 0,
    heldVks: new Set(),
  };

  private rings: ImpactRing[] = [];
  private sparks: FloatingSpark[] = [];

  constructor() {
    const mk = (src: string) => {
      const img = new Image();
      img.src = src;
      return img;
    };
    this.sprites = {
      idle: mk(idleUrl),
      privacy: mk(privacyUrl),
    };
  }

  public onPrivacyModeChanged(active: boolean): void {
    if (active) {
      this.leftPaw.heldVks.clear();
      this.rightPaw.heldVks.clear();
      this.rings.length = 0;
    }
  }

  public onPrivacyTyping(): void {
    this.bodyBob = Math.min(0.65, this.bodyBob + 0.42);
  }

  public resetLeftHandForMouse(): void {
    this.leftPaw.lastAt = -10000;
  }

  public onKeyDown(
    vk: number,
    pt: { x: number; y: number },
    layout: MonokumaLayout,
    repeat: boolean,
  ): void {
    if (layout.privacyMode || repeat) return;
    const now = performance.now();
    this.lastKeyAt = now;
    this.bodyBob = Math.min(1.05, this.bodyBob + 0.68);

    const normX = Math.max(-1, Math.min(1, (pt.x - layout.kbCenterX) / (layout.kbWidth * 0.48)));
    const mouseBusy = layout.mouseLeft || layout.mouseRight || now - layout.mouseActiveAt < 900;

    // Determine which bear paw strikes:
    // - When mouse is active, left white bear paw stays on mouse and right black bear paw taps keys.
    // - Spacebar alternates paws cleanly; otherwise left keys use left white paw, right keys use right black paw.
    let useLeft: boolean;
    if (mouseBusy) {
      useLeft = false;
    } else if (vk === 0x20) {
      this.lastSpacePaw = this.lastSpacePaw === 'left' ? 'right' : 'left';
      useLeft = this.lastSpacePaw === 'left';
    } else {
      useLeft = pt.x < layout.kbCenterX - 2;
    }

    if (!mouseBusy) {
      this.bodyTiltTarget = normX * 0.085;
      this.bodyShiftTarget = normX * (layout.is108 ? 34 : 18);
    }

    // Land the round bear paw accurately on the exact keycap world center!
    if (useLeft) {
      this.leftPaw.tx = pt.x;
      this.leftPaw.ty = pt.y;
      this.leftPaw.lastAt = now;
      this.leftPaw.squash = 1;
      this.leftPaw.heldVks.add(vk);
    } else {
      this.rightPaw.tx = pt.x;
      this.rightPaw.ty = pt.y;
      this.rightPaw.lastAt = now;
      this.rightPaw.squash = 1;
      this.rightPaw.heldVks.add(vk);
    }

    // Subtle crimson Danganronpa strike ring right under the struck keycap
    if (this.rings.length >= 6) {
      this.rings.shift();
    }
    this.rings.push({ x: pt.x, y: pt.y, r: 4, life: 1 });
  }

  public onKeyUp(vk: number): void {
    this.leftPaw.heldVks.delete(vk);
    this.rightPaw.heldVks.delete(vk);
  }

  private spawnSparks(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.sparks.push({
        x: x + (Math.random() - 0.5) * 44,
        y: y + (Math.random() - 0.5) * 14,
        vx: (Math.random() - 0.5) * 0.9,
        vy: -1.0 - Math.random() * 1.1,
        life: 1,
        size: 3.2 + Math.random() * 2.4,
      });
    }
  }

  public update(dt: number, now: number, layout: MonokumaLayout): void {
    this.bodyBob *= Math.exp(-12 * dt);

    const isHappy = !layout.privacyMode && layout.petEnergy > 0.25;
    const isTyping =
      !layout.privacyMode &&
      (now - this.lastKeyAt < 550 ||
        this.leftPaw.heldVks.size > 0 ||
        this.rightPaw.heldVks.size > 0);
    const mouseMode =
      !layout.privacyMode &&
      !isHappy &&
      (layout.mouseLeft || layout.mouseRight || now - layout.mouseActiveAt < 900);

    const charX = layout.is108 ? 268 : 196;
    if (isHappy && Math.random() < 0.06) {
      this.spawnSparks(charX + this.bodyShiftX, 118, 1);
    }

    if (layout.privacyMode) {
      this.bodyShiftTarget = 0;
      const shySway =
        Math.sin(now * 0.0044) * 0.028 +
        (now - layout.privacyTypingAt < 240 ? Math.sin(now * 0.042) * 0.022 : 0);
      this.bodyTiltTarget = shySway;
      this.bodyDiveY *= Math.exp(-9 * dt);
    } else if (mouseMode) {
      const baseShift = layout.is108 ? -118 : -36;
      this.bodyShiftTarget = baseShift + (layout.mouseNX - 0.5) * 12;
      this.bodyTiltTarget = -0.09;
      this.bodyDiveY += (7 - this.bodyDiveY) * (1 - Math.exp(-10 * dt));
    } else if (!isTyping) {
      this.bodyShiftTarget = 0;
      this.bodyTiltTarget = 0;
      this.bodyDiveY *= Math.exp(-9 * dt);
    } else {
      this.bodyDiveY *= Math.exp(-9 * dt);
    }

    const shiftAcc = (this.bodyShiftTarget - this.bodyShiftX) * 165 - this.bodyShiftVel * 18;
    this.bodyShiftVel += shiftAcc * dt;
    this.bodyShiftX += this.bodyShiftVel * dt;

    const tiltAcc = (this.bodyTiltTarget - this.bodyTilt) * 180 - this.bodyTiltVel * 17;
    this.bodyTiltVel += tiltAcc * dt;
    this.bodyTilt += this.bodyTiltVel * dt;

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const rp = this.rings[i];
      rp.r += 48 * dt;
      rp.life -= 3.2 * dt;
      if (rp.life <= 0) this.rings.splice(i, 1);
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.022 * (dt * 60);
      if (p.life <= 0) this.sparks.splice(i, 1);
    }
  }

  private computeGeom(now: number, layout: MonokumaLayout) {
    const charX = layout.is108 ? 268 : 196;
    const baseCharY = layout.is108 ? 358 : 356;
    const breath = Math.sin(now * 0.0034) * 2.1 + this.bodyBob * 3.6 + this.bodyDiveY;
    const charCenterX = charX + this.bodyShiftX;
    const charBaseY = baseCharY + breath;
    const drawW = layout.is108 ? 226 : 218;
    const drawH = drawW * (278 / 224);
    const pivotOff = 46;
    const pivotY = charBaseY - pivotOff;

    const spritePointToWorld = (normX: number, normY: number) => {
      const lx = (normX - 0.5) * drawW;
      const ly = normY * drawH - drawH + pivotOff;
      const c = Math.cos(this.bodyTilt);
      const s = Math.sin(this.bodyTilt);
      return {
        x: charCenterX + lx * c - ly * s,
        y: pivotY + lx * s + ly * c,
      };
    };

    return {
      charCenterX,
      charBaseY,
      drawW,
      drawH,
      pivotOff,
      pivotY,
      spritePointToWorld,
    };
  }

  /** Layer 1 (drawn BEFORE keyboard & mouse): Monokuma sprite (idle or eye-covering privacy state). */
  public renderBody(ctx: CanvasRenderingContext2D, now: number, layout: MonokumaLayout): void {
    const g = this.computeGeom(now, layout);
    const privacyImg = this.sprites.privacy;
    const idleImg = this.sprites.idle;
    const usePrivacySprite =
      layout.privacyMode && privacyImg && privacyImg.complete && privacyImg.naturalWidth > 0;
    const img = usePrivacySprite ? privacyImg : idleImg;

    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, layout.logicalW, layout.kbCenterY - layout.kbHeight * 0.36);
      ctx.clip();
      ctx.translate(g.charCenterX, g.pivotY);
      ctx.rotate(this.bodyTilt);
      ctx.scale(1 + this.bodyBob * 0.022, 1 - this.bodyBob * 0.018);
      ctx.drawImage(img, -g.drawW * 0.5, -g.drawH + g.pivotOff, g.drawW, g.drawH);
      ctx.restore();
    }
  }

  /** Layer 2 (drawn AFTER keyboard & mouse): crimson impact rings, white left bear paw & black right bear paw, sparks. */
  public renderForeground(
    ctx: CanvasRenderingContext2D,
    dt: number,
    now: number,
    layout: MonokumaLayout,
  ): void {
    const g = this.computeGeom(now, layout);
    const shL = g.spritePointToWorld(0.24, 0.57);
    const shR = g.spritePointToWorld(0.76, 0.57);

    const privacySpriteLoaded =
      this.sprites.privacy &&
      this.sprites.privacy.complete &&
      this.sprites.privacy.naturalWidth > 0;

    // 1) Crimson strike rings on struck keycaps
    for (const rp of this.rings) {
      ctx.save();
      ctx.globalAlpha = rp.life * 0.65;
      ctx.strokeStyle = DESPAIR_RED;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.56, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // In privacy mode, `privacy.png` already renders Monokuma covering his eyes with both paws;
    // only draw procedural eye-covering paws as a graceful fallback if `privacy.png` isn't loaded.
    if (layout.privacyMode && privacySpriteLoaded) {
      this.leftPaw.x = shL.x - 10;
      this.leftPaw.y = shL.y + 18;
      this.rightPaw.x = shR.x + 10;
      this.rightPaw.y = shR.y + 18;
      this.leftPaw.squash = 0;
      this.rightPaw.squash = 0;
      return;
    }

    const isHappy = !layout.privacyMode && layout.petEnergy > 0.25;
    const mouseMode =
      !layout.privacyMode &&
      !isHappy &&
      (layout.mouseLeft || layout.mouseRight || now - layout.mouseActiveAt < 900);

    const leftTyping =
      !layout.privacyMode &&
      !mouseMode &&
      (now - this.leftPaw.lastAt < 340 || this.leftPaw.heldVks.size > 0);
    const rightTyping =
      !layout.privacyMode &&
      (now - this.rightPaw.lastAt < 340 || this.rightPaw.heldVks.size > 0);

    let lTargetX: number;
    let lTargetY: number;
    let rTargetX: number;
    let rTargetY: number;

    if (layout.privacyMode) {
      // Fallback procedural eye-cover pose
      const eyeL = g.spritePointToWorld(0.36, 0.28);
      const eyeR = g.spritePointToWorld(0.64, 0.28);
      const shyBob = Math.sin(now * 0.008) * 1.4;
      lTargetX = eyeL.x;
      lTargetY = eyeL.y + shyBob;
      rTargetX = eyeR.x;
      rTargetY = eyeR.y - shyBob;
    } else if (isHappy) {
      const cheer = Math.sin(now * 0.016) * 5.2;
      lTargetX = shL.x - 16;
      lTargetY = shL.y + 2 + cheer;
      rTargetX = shR.x + 16;
      rTargetY = shR.y + 2 - cheer;
    } else {
      if (mouseMode) {
        const pressOff = layout.mouseLeft || layout.mouseRight ? 2.4 : 0;
        lTargetX = layout.mouseBtnX;
        lTargetY = layout.mouseBtnY + pressOff;
      } else if (leftTyping) {
        lTargetX = this.leftPaw.tx;
        lTargetY = this.leftPaw.ty;
      } else {
        lTargetX = shL.x - 12;
        lTargetY = shL.y + 30;
      }

      if (rightTyping) {
        rTargetX = this.rightPaw.tx;
        rTargetY = this.rightPaw.ty;
      } else {
        rTargetX = shR.x + 12;
        rTargetY = shR.y + 30;
      }
    }

    // Snappy interpolation so paws land right on each keycap without lag
    const hLerp = 1 - Math.exp(-34 * dt);
    this.leftPaw.x += (lTargetX - this.leftPaw.x) * hLerp;
    this.leftPaw.y += (lTargetY - this.leftPaw.y) * hLerp;
    this.rightPaw.x += (rTargetX - this.rightPaw.x) * hLerp;
    this.rightPaw.y += (rTargetY - this.rightPaw.y) * hLerp;
    this.leftPaw.squash *= Math.exp(-15 * dt);
    this.rightPaw.squash *= Math.exp(-15 * dt);

    // Draw Left White Round Bear Paw & Right Black Round Bear Paw
    this.drawMonokumaBearPaw(
      ctx,
      shL.x,
      shL.y,
      this.leftPaw.x,
      this.leftPaw.y,
      'left',
      this.leftPaw.squash,
      leftTyping || mouseMode,
    );
    this.drawMonokumaBearPaw(
      ctx,
      shR.x,
      shR.y,
      this.rightPaw.x,
      this.rightPaw.y,
      'right',
      this.rightPaw.squash,
      rightTyping,
    );

    // Subtle crimson Danganronpa star sparks when petted
    for (const p of this.sparks) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.fillStyle = DESPAIR_RED;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.8;
      this.drawFourPointStar(ctx, p.size);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawFourPointStar(ctx: CanvasRenderingContext2D, r: number): void {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4;
      const rad = i % 2 === 0 ? r : r * 0.36;
      const x = Math.cos(ang) * rad;
      const y = Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /**
   * Draws a plush Monokuma bear arm + round bear paw that lands directly at (px, py):
   * - side === 'left': Pure white plush bear arm & white round bear paw (左侧白色圆熊掌)
   * - side === 'right': Jet black plush bear arm & black round bear paw (右侧黑色圆熊掌)
   */
  private drawMonokumaBearPaw(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    px: number,
    py: number,
    side: 'left' | 'right',
    squash: number,
    activeStrike: boolean,
  ): void {
    const isWhite = side === 'left';
    const dx = px - sx;
    const dy = py - sy;
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const ang = Math.atan2(dy, dx);
    const sgn = isWhite ? -1 : 1;

    // Slight natural outward elbow curve while keeping exact paw tip at (px, py)
    const bow = Math.min(10, len * 0.12) * sgn;
    const midX = (sx + px) * 0.5 + nx * bow;
    const midY = (sy + py) * 0.5 + ny * bow;

    const rSh = 10.2;
    const rWrist = 8.6;
    const wristDist = Math.max(4, len - 6.5);
    const wx = sx + ux * wristDist;
    const wy = sy + uy * wristDist;

    ctx.save();

    // Soft contact shadow directly under struck keycap
    if (activeStrike) {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 16, 22, 0.24)';
      ctx.beginPath();
      ctx.ellipse(px, py + 4.5, 11.2, 6.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 1) Plush bear arm
    const armGrad = ctx.createLinearGradient(sx, sy, px, py);
    if (isWhite) {
      armGrad.addColorStop(0, '#eef0f4');
      armGrad.addColorStop(0.55, '#ffffff');
      armGrad.addColorStop(1, '#f7f8fa');
    } else {
      armGrad.addColorStop(0, '#141519');
      armGrad.addColorStop(0.55, '#202229');
      armGrad.addColorStop(1, '#18191f');
    }

    ctx.beginPath();
    ctx.moveTo(sx + nx * rSh, sy + ny * rSh);
    ctx.quadraticCurveTo(midX + nx * 9.8, midY + ny * 9.8, wx + nx * rWrist, wy + ny * rWrist);
    ctx.lineTo(wx - nx * rWrist, wy - ny * rWrist);
    ctx.quadraticCurveTo(midX - nx * 9.8, midY - ny * 9.8, sx - nx * rSh, sy - ny * rSh);
    ctx.closePath();
    ctx.fillStyle = armGrad;
    ctx.fill();

    // Clean shoulder cap to merge seamlessly with Monokuma's torso
    ctx.beginPath();
    ctx.arc(sx, sy, rSh, 0, Math.PI * 2);
    ctx.fill();

    // Crisp anime arm outline
    ctx.strokeStyle = isWhite ? '#1a1b20' : '#09090c';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx + nx * rSh, sy + ny * rSh);
    ctx.quadraticCurveTo(midX + nx * 9.8, midY + ny * 9.8, wx + nx * rWrist, wy + ny * rWrist);
    ctx.moveTo(sx - nx * rSh, sy - ny * rSh);
    ctx.quadraticCurveTo(midX - nx * 9.8, midY - ny * 9.8, wx - nx * rWrist, wy - ny * rWrist);
    ctx.stroke();

    // Subtle rim highlight along the black arm so it stays crisp over dark keyboard areas
    if (!isWhite) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(sx + nx * (rSh - 3.2), sy + ny * (rSh - 3.2));
      ctx.quadraticCurveTo(
        midX + nx * 6.4,
        midY + ny * 6.4,
        wx + nx * (rWrist - 2.6),
        wy + ny * (rWrist - 2.6),
      );
      ctx.stroke();
    }

    // 2) Round bear paw centered EXACTLY on (px, py)
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);

    const rx = 10.6 * (1 + squash * 0.16);
    const ry = 10.2 * (1 - squash * 0.11);

    const pawGrad = ctx.createRadialGradient(-2.4, -2.6, 1.2, 0, 0, rx * 1.15);
    if (isWhite) {
      pawGrad.addColorStop(0, '#ffffff');
      pawGrad.addColorStop(0.72, '#f4f5f8');
      pawGrad.addColorStop(1, '#dde0e7');
    } else {
      pawGrad.addColorStop(0, '#363944');
      pawGrad.addColorStop(0.55, '#1c1e24');
      pawGrad.addColorStop(1, '#101115');
    }

    ctx.fillStyle = pawGrad;
    ctx.strokeStyle = isWhite ? '#18191e' : '#08080a';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Subtle outer rim highlight for black round bear paw so silhouette pops cleanly
    if (!isWhite) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx - 1.5, ry - 1.5, 0, -Math.PI * 0.85, Math.PI * 0.15);
      ctx.stroke();
    }

    // Cute subtle bear paw sheen + tiny knuckle indents (plush teddy-bear paw feel!)
    ctx.fillStyle = isWhite ? 'rgba(255, 255, 255, 0.88)' : 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.ellipse(-2.8, -3.0, 3.0, 2.0, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // Subtle plush bear toe-bean / knuckle dots at the front rim of the round bear paw
    ctx.fillStyle = isWhite ? 'rgba(30, 32, 40, 0.14)' : 'rgba(255, 255, 255, 0.12)';
    for (const ty of [-3.6, 0, 3.6]) {
      ctx.beginPath();
      ctx.arc(rx * 0.56, ty, 1.35, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tiny crimson impact glow rim on strike squash
    if (squash > 0.18) {
      ctx.strokeStyle = `rgba(230, 0, 18, ${(squash * 0.55).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx + 1.4, ry + 1.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
    ctx.restore();
  }
}

export { DESPAIR_RED, DESPAIR_RED_DARK };
