import idleUrl from './assets/monokuma/idle.png';
import blinkUrl from './assets/monokuma/blink.png';
import happyUrl from './assets/monokuma/happy.png';
import privacyUrl from './assets/monokuma/privacy.png';
import type { DaFeiYuLayout } from './dafeiyuRenderer';

export type MonokumaLayout = DaFeiYuLayout;

interface PawSmear {
  sx: number;
  sy: number;
  px: number;
  py: number;
  alpha: number;
}

interface PawState {
  x: number;
  y: number;
  startX: number;
  startY: number;
  tx: number;
  ty: number;
  lastAt: number;
  strikeElapsed: number;
  strikeDuration: number;
  arcHeight: number;
  squash: number;
  clawExtend: number;
  heldVks: Set<number>;
  smears: PawSmear[];
}

interface ImpactRing {
  x: number;
  y: number;
  r: number;
  life: number;
  heavy: boolean;
}

interface FloatingParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  kind: 'star' | 'upupu' | 'spark';
  rot: number;
}

const DESPAIR_RED = '#E60012';
const DESPAIR_RED_DARK = '#99000C';

// Heavy / dramatic action keys (Enter, Backspace, Space, Esc)
const HEAVY_VKS = new Set([0x0d, 0x08, 0x20, 0x1b]);

/**
 * High-fidelity Danganronpa Monokuma (弹丸论破 黑白熊) standalone companion renderer.
 * Features:
 * - 5 pixel-aligned official-style transparent sprites (`idle`, `blink`, `happy`, `excited`, `privacy`)
 * - Hysteresis-locked typing speed emotion state machine ("Upupupu~" happy & manic crimson-eye excited modes)
 * - Natural periodic blinking, petting giggle bounce, and guilty trembling eye-cover password privacy mode
 * - Parabolic lift-and-slam bear paw strike arcs with motion-blur smears, landing accurately on every keycap
 * - Left white plush round bear paw & right black plush round bear paw with retractable Danganronpa claws
 * - Signature crimson (#E60012) eye gleam, strike ripples, and floating "うぷぷ" / despair star particles
 */
export class MonokumaRenderer {
  private sprites: Record<'idle' | 'blink' | 'happy' | 'privacy', HTMLImageElement>;

  private lastKeyAt = -10000;
  private keyTimes: number[] = [];
  private typingHeat = 0;
  private moodTier: 0 | 1 | 2 = 0;
  private moodChangedAt = -10000;
  private heavyFlashUntil = 0;
  private eyeGleam = 0;

  private nextBlinkAt = performance.now() + 3400 + Math.random() * 2600;
  private blinkUntil = 0;

  private bodyShiftX = 0;
  private bodyShiftVel = 0;
  private bodyShiftTarget = 0;
  private bodyTilt = 0;
  private bodyTiltVel = 0;
  private bodyTiltTarget = 0;
  private bodyDiveY = 0;
  private bodyBob = 0;
  private groovePhase = 0;
  private lastSpacePaw: 'left' | 'right' = 'left';
  private prevMouseDown = false;

  private leftPaw: PawState = {
    x: 150,
    y: 314,
    startX: 150,
    startY: 314,
    tx: 150,
    ty: 314,
    lastAt: -10000,
    strikeElapsed: 1,
    strikeDuration: 0.13,
    arcHeight: 0,
    squash: 0,
    clawExtend: 0,
    heldVks: new Set(),
    smears: [],
  };

  private rightPaw: PawState = {
    x: 242,
    y: 314,
    startX: 242,
    startY: 314,
    tx: 242,
    ty: 314,
    lastAt: -10000,
    strikeElapsed: 1,
    strikeDuration: 0.13,
    arcHeight: 0,
    squash: 0,
    clawExtend: 0,
    heldVks: new Set(),
    smears: [],
  };

  private rings: ImpactRing[] = [];
  private particles: FloatingParticle[] = [];

  constructor() {
    const mk = (src: string) => {
      const img = new Image();
      img.src = src;
      return img;
    };
    this.sprites = {
      idle: mk(idleUrl),
      blink: mk(blinkUrl),
      happy: mk(happyUrl),
      privacy: mk(privacyUrl),
    };
  }

  public onPrivacyModeChanged(active: boolean): void {
    if (active) {
      this.leftPaw.heldVks.clear();
      this.rightPaw.heldVks.clear();
      this.leftPaw.smears.length = 0;
      this.rightPaw.smears.length = 0;
      this.rings.length = 0;
    }
  }

  public onPrivacyTyping(): void {
    this.bodyBob = Math.min(0.75, this.bodyBob + 0.46);
  }

  public resetLeftHandForMouse(): void {
    this.leftPaw.lastAt = -10000;
    this.leftPaw.squash = Math.max(this.leftPaw.squash, 0.65);
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
    this.keyTimes.push(now);
    const isHeavy = HEAVY_VKS.has(vk);
    this.bodyBob = Math.min(1.2, this.bodyBob + (isHeavy ? 0.92 : 0.66));
    if (isHeavy) {
      this.heavyFlashUntil = now + 260;
      this.eyeGleam = Math.min(1, this.eyeGleam + 0.85);
    } else {
      this.eyeGleam = Math.min(1, this.eyeGleam + 0.18 + this.typingHeat * 0.25);
    }

    const normX = Math.max(-1, Math.min(1, (pt.x - layout.kbCenterX) / (layout.kbWidth * 0.48)));
    const mouseBusy = layout.mouseLeft || layout.mouseRight || now - layout.mouseActiveAt < 900;

    // Assign bear paw:
    // - Mouse active -> left white bear paw stays on mouse; right black bear paw taps keyboard
    // - Spacebar alternates paws; otherwise left keys -> left white paw, right keys -> right black paw
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
      this.bodyTiltTarget = normX * 0.095;
      this.bodyShiftTarget = normX * (layout.is108 ? 34 : 19);
    }

    const paw = useLeft ? this.leftPaw : this.rightPaw;
    const moveDist = Math.hypot(pt.x - paw.x, pt.y - paw.y);

    // Record motion-blur smear when paw swings quickly across keys
    if (moveDist > 20) {
      const g = this.computeGeom(now, layout);
      const sh = useLeft ? g.spritePointToWorld(0.21, 0.56) : g.spritePointToWorld(0.79, 0.56);
      paw.smears.push({
        sx: sh.x,
        sy: sh.y,
        px: paw.x,
        py: paw.y,
        alpha: 0.34,
      });
      if (paw.smears.length > 3) paw.smears.shift();
    }

    // Exact keycap world center targeting with parabolic slam arc!
    paw.startX = paw.x;
    paw.startY = paw.y;
    paw.tx = pt.x;
    paw.ty = pt.y;
    paw.lastAt = now;
    paw.strikeElapsed = 0;
    paw.strikeDuration = Math.min(0.135, Math.max(0.075, 0.075 + moveDist * 0.00045));
    paw.arcHeight = Math.min(20, (isHeavy ? 14 : 9) + moveDist * 0.08);
    paw.squash = isHeavy ? 1.15 : 0.95;
    paw.clawExtend = Math.min(1, paw.clawExtend + (isHeavy ? 0.95 : 0.35 + this.typingHeat * 0.5));
    paw.heldVks.add(vk);

    // Crimson strike ripple directly on the struck keycap
    if (this.rings.length >= 8) {
      this.rings.shift();
    }
    this.rings.push({ x: pt.x, y: pt.y, r: isHeavy ? 5 : 3.5, life: 1, heavy: isHeavy });

    // Spawn small crimson sparks on heavy hits or manic typing heat
    if (isHeavy || this.typingHeat > 0.55) {
      this.spawnParticles(pt.x, pt.y - 6, isHeavy ? 3 : 1, 'spark');
    }
  }

  public onKeyUp(vk: number): void {
    this.leftPaw.heldVks.delete(vk);
    this.rightPaw.heldVks.delete(vk);
  }

  private spawnParticles(
    x: number,
    y: number,
    count: number,
    kind: 'star' | 'upupu' | 'spark',
  ): void {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * (kind === 'spark' ? 24 : 56),
        y: y + (Math.random() - 0.5) * 14,
        vx: (Math.random() - 0.5) * (kind === 'spark' ? 2.4 : 0.75),
        vy: kind === 'spark' ? -1.4 - Math.random() * 1.4 : -0.85 - Math.random() * 0.9,
        life: 1,
        size: kind === 'spark' ? 2.6 + Math.random() * 2.0 : 4.2 + Math.random() * 2.6,
        kind,
        rot: (Math.random() - 0.5) * 0.5,
      });
    }
    if (this.particles.length > 24) {
      this.particles.splice(0, this.particles.length - 24);
    }
  }

  public update(dt: number, now: number, layout: MonokumaLayout): void {
    this.bodyBob *= Math.exp(-12.5 * dt);
    this.eyeGleam *= Math.exp(-5.2 * dt);

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

    // 1) Typing-speed heat window (2.6s) + hysteresis-locked mood tiers (zero flicker!)
    while (this.keyTimes.length && now - this.keyTimes[0] > 2600) {
      this.keyTimes.shift();
    }
    const typingCPS = this.keyTimes.length / 2.6;
    const heatTarget = layout.privacyMode
      ? 0
      : Math.min(1, Math.max(0, (typingCPS - 2.2) / 5.2));
    const heatRate = heatTarget > this.typingHeat ? 2.8 : 0.75;
    this.typingHeat += (heatTarget - this.typingHeat) * (1 - Math.exp(-heatRate * dt));

    const dwell = now - this.moodChangedAt;
    if (this.moodTier === 0) {
      if (this.typingHeat >= 0.38 && dwell >= 1100) {
        this.moodTier = 1; // excited / blazing red eye
        this.moodChangedAt = now;
      }
    } else if (this.moodTier === 1) {
      if (this.typingHeat >= 0.78 && dwell >= 1500) {
        this.moodTier = 2; // manic "Upupupu~" frenzy
        this.moodChangedAt = now;
      } else if (this.typingHeat < 0.20 && dwell >= 1800) {
        this.moodTier = 0;
        this.moodChangedAt = now;
      }
    } else if (this.moodTier === 2) {
      if (this.typingHeat < 0.54 && dwell >= 1800) {
        this.moodTier = 1;
        this.moodChangedAt = now;
      }
    }

    if (isTyping) {
      this.groovePhase += dt * (7.5 + this.typingHeat * 7.5);
    } else {
      this.groovePhase += dt * 2.2;
    }

    // 2) Natural periodic blinking every 3.8 - 6.6s
    if (now >= this.nextBlinkAt) {
      this.blinkUntil = now + 145;
      this.nextBlinkAt = now + 3800 + Math.random() * 2800;
    }

    // 3) Celebratory "うぷぷ" / star particles when petted or in peak typing frenzy
    const charX = layout.is108 ? 268 : 196;
    if (isHappy && Math.random() < 0.075) {
      this.spawnParticles(
        charX + this.bodyShiftX,
        106,
        1,
        Math.random() < 0.36 ? 'upupu' : 'star',
      );
    } else if (!layout.privacyMode && this.moodTier === 2 && Math.random() < 0.04) {
      this.spawnParticles(
        charX + this.bodyShiftX,
        112,
        1,
        Math.random() < 0.42 ? 'upupu' : 'star',
      );
    }

    // Mouse click crimson ripple feedback
    const mouseDownNow = layout.mouseLeft || layout.mouseRight;
    if (mouseDownNow && !this.prevMouseDown && !layout.privacyMode) {
      this.rings.push({
        x: layout.mouseBtnX,
        y: layout.mouseBtnY,
        r: 4,
        life: 0.9,
        heavy: false,
      });
    }
    this.prevMouseDown = mouseDownNow;

    // 4) Expressive spring torso physics
    if (layout.privacyMode) {
      this.bodyShiftTarget = 0;
      const shySway =
        Math.sin(now * 0.0048) * 0.032 +
        (now - layout.privacyTypingAt < 260 ? Math.sin(now * 0.052) * 0.028 : 0);
      this.bodyTiltTarget = shySway;
      this.bodyDiveY *= Math.exp(-9 * dt);
    } else if (isHappy) {
      // Joyful "Upupupu~" laughing giggle rock!
      this.bodyShiftTarget = Math.sin(now * 0.011) * 4.5;
      this.bodyTiltTarget = Math.sin(now * 0.014) * 0.068;
      this.bodyDiveY *= Math.exp(-9 * dt);
    } else if (mouseMode) {
      const baseShift = layout.is108 ? -116 : -36;
      this.bodyShiftTarget = baseShift + (layout.mouseNX - 0.5) * 12;
      this.bodyTiltTarget = -0.095;
      this.bodyDiveY += (7.5 - this.bodyDiveY) * (1 - Math.exp(-10 * dt));
    } else if (!isTyping) {
      this.bodyShiftTarget = 0;
      this.bodyTiltTarget = Math.sin(now * 0.0018) * 0.012;
      this.bodyDiveY *= Math.exp(-9 * dt);
    } else {
      // Rhythmic micro-groove bounce while typing
      this.bodyTiltTarget += Math.sin(this.groovePhase) * 0.002;
      this.bodyDiveY += (2.5 + this.typingHeat * 4.0 - this.bodyDiveY) * (1 - Math.exp(-8 * dt));
    }

    const shiftAcc = (this.bodyShiftTarget - this.bodyShiftX) * 165 - this.bodyShiftVel * 18;
    this.bodyShiftVel += shiftAcc * dt;
    this.bodyShiftX += this.bodyShiftVel * dt;

    const tiltAcc = (this.bodyTiltTarget - this.bodyTilt) * 185 - this.bodyTiltVel * 17;
    this.bodyTiltVel += tiltAcc * dt;
    this.bodyTilt += this.bodyTiltVel * dt;

    // 5) Decay paw smears, claws, impact rings, and particles
    for (const paw of [this.leftPaw, this.rightPaw]) {
      paw.strikeElapsed += dt;
      paw.clawExtend *= Math.exp(-4.2 * dt);
      for (let i = paw.smears.length - 1; i >= 0; i--) {
        paw.smears[i].alpha -= dt * 3.8;
        if (paw.smears[i].alpha <= 0) paw.smears.splice(i, 1);
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const rp = this.rings[i];
      rp.r += (rp.heavy ? 64 : 46) * dt;
      rp.life -= (rp.heavy ? 2.6 : 3.2) * dt;
      if (rp.life <= 0) this.rings.splice(i, 1);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.kind === 'spark') p.vy += 0.08 * (dt * 60);
      p.life -= (p.kind === 'upupu' ? 0.015 : 0.024) * (dt * 60);
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  private computeGeom(now: number, layout: MonokumaLayout) {
    const charX = layout.is108 ? 268 : 196;
    const baseCharY = layout.is108 ? 358 : 356;
    const isHappy = !layout.privacyMode && layout.petEnergy > 0.25;
    const happyHop = isHappy ? Math.abs(Math.sin(now * 0.015)) * -5.2 : 0;
    const breath =
      Math.sin(now * 0.0034) * 2.1 + this.bodyBob * 3.8 + this.bodyDiveY + happyHop;
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

  private pickExpression(
    now: number,
    layout: MonokumaLayout,
  ): 'idle' | 'blink' | 'happy' | 'excited' | 'privacy' {
    if (layout.privacyMode) return 'privacy';
    if (layout.petEnergy > 0.25 || this.moodTier === 2) return 'happy';
    if (this.moodTier === 1 || now < this.heavyFlashUntil) return 'excited';
    if (now < this.blinkUntil) return 'blink';
    return 'idle';
  }

  /** Layer 1 (drawn BEFORE keyboard & mouse): official-style Monokuma sprite + crimson eye gleam & hype vein. */
  public renderBody(ctx: CanvasRenderingContext2D, now: number, layout: MonokumaLayout): void {
    const g = this.computeGeom(now, layout);
    const expr = this.pickExpression(now, layout);
    const spriteKey: 'idle' | 'blink' | 'happy' | 'privacy' =
      expr === 'excited' ? 'idle' : expr;
    const candidate = this.sprites[spriteKey];
    const img =
      candidate && candidate.complete && candidate.naturalWidth > 0 ? candidate : this.sprites.idle;

    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, layout.logicalW, layout.kbCenterY - layout.kbHeight * 0.36);
      ctx.clip();
      ctx.translate(g.charCenterX, g.pivotY);
      ctx.rotate(this.bodyTilt);
      const sqX = 1 + this.bodyBob * 0.026;
      const sqY = 1 - this.bodyBob * 0.022;
      ctx.scale(sqX, sqY);
      ctx.drawImage(img, -g.drawW * 0.5, -g.drawH + g.pivotOff, g.drawW, g.drawH);

      // Subtle animated Danganronpa crimson (#E60012) eye gleam on right eye during hype/heavy strikes
      if (!layout.privacyMode && expr !== 'blink') {
        const gleamAlpha = Math.min(
          0.92,
          this.eyeGleam * 0.68 + (expr === 'excited' ? 0.42 + Math.sin(now * 0.024) * 0.16 : 0),
        );
        if (gleamAlpha > 0.06) {
          const ex = (0.655 - 0.5) * g.drawW;
          const ey = 0.270 * g.drawH - g.drawH + g.pivotOff;
          const glowR = 14 + gleamAlpha * 11;
          const grad = ctx.createRadialGradient(ex, ey, 1, ex, ey, glowR);
          grad.addColorStop(0, `rgba(255, 42, 58, ${(gleamAlpha * 0.78).toFixed(3)})`);
          grad.addColorStop(0.45, `rgba(230, 0, 18, ${(gleamAlpha * 0.38).toFixed(3)})`);
          grad.addColorStop(1, 'rgba(230, 0, 18, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(ex, ey, glowR, 0, Math.PI * 2);
          ctx.fill();

          if (gleamAlpha > 0.42) {
            ctx.save();
            ctx.translate(ex, ey);
            ctx.fillStyle = `rgba(255, 240, 242, ${((gleamAlpha - 0.32) * 0.96).toFixed(3)})`;
            this.drawFourPointStar(ctx, 5.8 + gleamAlpha * 5.0);
            ctx.fill();
            ctx.restore();
          }
        }

        // Classic pulsing anime crimson vein mark on white forehead during fast-typing hype (`excited`)
        if (expr === 'excited') {
          const vx = (0.285 - 0.5) * g.drawW;
          const vy = 0.175 * g.drawH - g.drawH + g.pivotOff;
          const pulse = 1 + Math.sin(now * 0.028) * 0.14;
          ctx.save();
          ctx.translate(vx, vy);
          ctx.scale(pulse, pulse);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 4.2;
          ctx.lineCap = 'round';
          this.traceAnimeVein(ctx);
          ctx.stroke();
          ctx.strokeStyle = DESPAIR_RED;
          ctx.lineWidth = 2.1;
          this.traceAnimeVein(ctx);
          ctx.stroke();
          ctx.restore();
        }
      }

      ctx.restore();
    }
  }

  private traceAnimeVein(ctx: CanvasRenderingContext2D): void {
    const r = 6.2;
    ctx.beginPath();
    // 4-quadrant anime pop-vein arcs
    ctx.moveTo(-r, -1.6);
    ctx.quadraticCurveTo(-1.8, -1.8, -1.6, -r);
    ctx.moveTo(r, -1.6);
    ctx.quadraticCurveTo(1.8, -1.8, 1.6, -r);
    ctx.moveTo(-r, 1.6);
    ctx.quadraticCurveTo(-1.8, 1.8, -1.6, r);
    ctx.moveTo(r, 1.6);
    ctx.quadraticCurveTo(1.8, 1.8, 1.6, r);
  }

  /** Layer 2 (drawn AFTER keyboard & mouse): crimson ripples, parabolic bear paws w/ smears & claws, particles. */
  public renderForeground(
    ctx: CanvasRenderingContext2D,
    dt: number,
    now: number,
    layout: MonokumaLayout,
  ): void {
    const g = this.computeGeom(now, layout);
    const shL = g.spritePointToWorld(0.21, 0.56);
    const shR = g.spritePointToWorld(0.79, 0.56);

    const privacySpriteLoaded =
      this.sprites.privacy &&
      this.sprites.privacy.complete &&
      this.sprites.privacy.naturalWidth > 0;

    // 1) Crimson strike ripples on struck keycaps
    for (const rp of this.rings) {
      ctx.save();
      ctx.globalAlpha = rp.life * (rp.heavy ? 0.8 : 0.6);
      ctx.strokeStyle = DESPAIR_RED;
      ctx.lineWidth = rp.heavy ? 2.5 : 1.9;
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // In privacy mode, `privacy.png` already renders Monokuma covering his eyes with both bear paws
    if (layout.privacyMode && privacySpriteLoaded) {
      this.leftPaw.x = shL.x - 6;
      this.leftPaw.y = shL.y + 18;
      this.rightPaw.x = shR.x + 6;
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
      (now - this.leftPaw.lastAt < 350 || this.leftPaw.heldVks.size > 0);
    const rightTyping =
      !layout.privacyMode &&
      (now - this.rightPaw.lastAt < 350 || this.rightPaw.heldVks.size > 0);

    const idleBobL = Math.sin(now * 0.0042) * 1.6;
    const idleBobR = Math.sin(now * 0.0042 + 0.9) * 1.6;

    let lTargetX: number;
    let lTargetY: number;
    let rTargetX: number;
    let rTargetY: number;

    if (layout.privacyMode) {
      const eyeL = g.spritePointToWorld(0.36, 0.28);
      const eyeR = g.spritePointToWorld(0.64, 0.28);
      const shyBob = Math.sin(now * 0.008) * 1.5;
      lTargetX = eyeL.x;
      lTargetY = eyeL.y + shyBob;
      rTargetX = eyeR.x;
      rTargetY = eyeR.y - shyBob;
    } else if (isHappy) {
      // Iconic "Upupupu~" cheeky paw bounce near mouth / cheerful wave!
      const cheer = Math.sin(now * 0.017) * 6.0;
      lTargetX = shL.x + 22 + Math.cos(now * 0.013) * 3;
      lTargetY = shL.y - 16 + cheer;
      rTargetX = shR.x - 10;
      rTargetY = shR.y - 8 - cheer;
    } else {
      if (mouseMode) {
        const pressOff = layout.mouseLeft || layout.mouseRight ? 2.6 : 0;
        lTargetX = layout.mouseBtnX;
        lTargetY = layout.mouseBtnY + pressOff;
      } else if (leftTyping) {
        lTargetX = this.leftPaw.tx;
        lTargetY = this.leftPaw.ty;
      } else {
        lTargetX = shL.x + 6;
        lTargetY = shL.y + 34 + idleBobL;
      }

      if (rightTyping) {
        rTargetX = this.rightPaw.tx;
        rTargetY = this.rightPaw.ty;
      } else {
        rTargetX = shR.x - 6;
        rTargetY = shR.y + 34 + idleBobR;
      }
    }

    // Parabolic strike arc lift so paws pounce downward onto keycaps rather than sliding flat!
    const computeArcOffset = (paw: PawState, active: boolean) => {
      if (!active || paw.strikeElapsed >= paw.strikeDuration) return 0;
      const u = paw.strikeElapsed / paw.strikeDuration;
      // Smooth quick rise, snappy downward slam at u = 1
      return -Math.sin(u * Math.PI) * paw.arcHeight * (1 - u * 0.25);
    };

    const hLerp = 1 - Math.exp(-36 * dt);
    this.leftPaw.x += (lTargetX - this.leftPaw.x) * hLerp;
    this.leftPaw.y += (lTargetY - this.leftPaw.y) * hLerp;
    this.rightPaw.x += (rTargetX - this.rightPaw.x) * hLerp;
    this.rightPaw.y += (rTargetY - this.rightPaw.y) * hLerp;
    this.leftPaw.squash *= Math.exp(-15 * dt);
    this.rightPaw.squash *= Math.exp(-15 * dt);

    const lArcY = computeArcOffset(this.leftPaw, leftTyping);
    const rArcY = computeArcOffset(this.rightPaw, rightTyping);

    // Draw motion-blur smears behind rapidly swinging paws
    for (const sm of this.leftPaw.smears) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, sm.alpha);
      this.drawMonokumaBearPaw(ctx, sm.sx, sm.sy, sm.px, sm.py, 'left', 0, 0, false);
      ctx.restore();
    }
    for (const sm of this.rightPaw.smears) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, sm.alpha);
      this.drawMonokumaBearPaw(ctx, sm.sx, sm.sy, sm.px, sm.py, 'right', 0, 0, false);
      ctx.restore();
    }

    // Draw Left White Round Bear Paw & Right Black Round Bear Paw (with retractable claws!)
    const rightClaws = Math.min(1, this.rightPaw.clawExtend + (this.moodTier >= 1 ? 0.55 : 0));
    this.drawMonokumaBearPaw(
      ctx,
      shL.x,
      shL.y,
      this.leftPaw.x,
      this.leftPaw.y + lArcY,
      'left',
      this.leftPaw.squash,
      this.leftPaw.clawExtend * 0.35,
      leftTyping || mouseMode,
    );
    this.drawMonokumaBearPaw(
      ctx,
      shR.x,
      shR.y,
      this.rightPaw.x,
      this.rightPaw.y + rArcY,
      'right',
      this.rightPaw.squash,
      rightClaws,
      rightTyping,
    );

    // Floating Danganronpa crimson stars, sparks, and "うぷぷ" laugh accents
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.kind === 'upupu') {
        ctx.font = '800 11px "Segoe UI", "PingFang SC", "Hiragino Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeText('うぷぷ', 0, 0);
        ctx.fillStyle = DESPAIR_RED;
        ctx.fillText('うぷぷ', 0, 0);
      } else {
        ctx.fillStyle = DESPAIR_RED;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = p.kind === 'spark' ? 0.7 : 1.0;
        this.drawFourPointStar(ctx, p.size);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawFourPointStar(ctx: CanvasRenderingContext2D, r: number): void {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4;
      const rad = i % 2 === 0 ? r : r * 0.34;
      const x = Math.cos(ang) * rad;
      const y = Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /**
   * Draws a refined plush Monokuma bear arm + round bear paw centered directly on (px, py):
   * - side === 'left': Pure white plush bear arm & white round bear paw (左侧白色圆熊掌)
   * - side === 'right': Sleek jet-black plush bear arm & black round bear paw with retractable claws (右侧黑色圆熊掌)
   */
  private drawMonokumaBearPaw(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    px: number,
    py: number,
    side: 'left' | 'right',
    squash: number,
    clawExtend: number,
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

    // Natural outward elbow curve while keeping exact paw tip at (px, py)
    const bow = Math.min(11, len * 0.13) * sgn;
    const midX = (sx + px) * 0.5 + nx * bow;
    const midY = (sy + py) * 0.5 + ny * bow;

    const rSh = 11.0;
    const rWrist = 8.8;
    const wristDist = Math.max(4, len - 6.5);
    const wx = sx + ux * wristDist;
    const wy = sy + uy * wristDist;

    ctx.save();

    // Contact shadow right under the struck keycap
    if (activeStrike) {
      ctx.save();
      ctx.fillStyle = 'rgba(12, 13, 18, 0.26)';
      ctx.beginPath();
      ctx.ellipse(px, py + 4.8, 11.6, 6.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 1) Plush bear arm with anime cel-shading
    const armGrad = ctx.createLinearGradient(
      midX - nx * 10,
      midY - ny * 10,
      midX + nx * 10,
      midY + ny * 10,
    );
    if (isWhite) {
      armGrad.addColorStop(0, '#dfe3ec');
      armGrad.addColorStop(0.32, '#ffffff');
      armGrad.addColorStop(0.85, '#f8f9fc');
      armGrad.addColorStop(1, '#d6dce6');
    } else {
      armGrad.addColorStop(0, '#0f1014');
      armGrad.addColorStop(0.35, '#252832');
      armGrad.addColorStop(0.85, '#191b22');
      armGrad.addColorStop(1, '#0d0e12');
    }

    ctx.beginPath();
    ctx.moveTo(sx + nx * rSh, sy + ny * rSh);
    ctx.quadraticCurveTo(midX + nx * 10.2, midY + ny * 10.2, wx + nx * rWrist, wy + ny * rWrist);
    ctx.lineTo(wx - nx * rWrist, wy - ny * rWrist);
    ctx.quadraticCurveTo(midX - nx * 10.2, midY - ny * 10.2, sx - nx * rSh, sy - ny * rSh);
    ctx.closePath();
    ctx.fillStyle = armGrad;
    ctx.fill();

    // Seamless shoulder cap
    ctx.beginPath();
    ctx.arc(sx, sy, rSh, 0, Math.PI * 2);
    ctx.fill();

    // Crisp anime ink outline
    ctx.strokeStyle = isWhite ? '#14151a' : '#070709';
    ctx.lineWidth = 2.25;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx + nx * rSh, sy + ny * rSh);
    ctx.quadraticCurveTo(midX + nx * 10.2, midY + ny * 10.2, wx + nx * rWrist, wy + ny * rWrist);
    ctx.moveTo(sx - nx * rSh, sy - ny * rSh);
    ctx.quadraticCurveTo(midX - nx * 10.2, midY - ny * 10.2, wx - nx * rWrist, wy - ny * rWrist);
    ctx.stroke();

    // Subtle rim highlight along black arm for crisp readability over dark keys
    if (!isWhite) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.17)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(sx + nx * (rSh - 3.4), sy + ny * (rSh - 3.4));
      ctx.quadraticCurveTo(
        midX + nx * 6.6,
        midY + ny * 6.6,
        wx + nx * (rWrist - 2.6),
        wy + ny * (rWrist - 2.6),
      );
      ctx.stroke();
    }

    // 2) Round plush bear paw centered EXACTLY on (px, py)
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);

    const rx = 10.8 * (1 + squash * 0.17);
    const ry = 10.4 * (1 - squash * 0.11);

    // Optional iconic Monokuma retractable claws on the right black paw (and tiny glint on heavy hits)
    if (!isWhite && clawExtend > 0.15) {
      const cLen = 3.2 + clawExtend * 3.8;
      ctx.save();
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#111216';
      ctx.lineWidth = 1.1;
      for (const cy of [-4.2, 0, 4.2]) {
        ctx.beginPath();
        ctx.moveTo(rx * 0.72, cy - 1.5);
        ctx.quadraticCurveTo(rx + cLen * 0.6, cy - 0.6, rx + cLen, cy);
        ctx.quadraticCurveTo(rx + cLen * 0.6, cy + 0.6, rx * 0.72, cy + 1.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    const pawGrad = ctx.createRadialGradient(-2.6, -2.8, 1.2, 0, 0, rx * 1.15);
    if (isWhite) {
      pawGrad.addColorStop(0, '#ffffff');
      pawGrad.addColorStop(0.68, '#f4f6fa');
      pawGrad.addColorStop(1, '#d7dce6');
    } else {
      pawGrad.addColorStop(0, '#3a3e4b');
      pawGrad.addColorStop(0.52, '#1c1e26');
      pawGrad.addColorStop(1, '#0f1014');
    }

    ctx.fillStyle = pawGrad;
    ctx.strokeStyle = isWhite ? '#14151a' : '#070709';
    ctx.lineWidth = 2.25;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Subtle crisp anime rim highlight on black paw
    if (!isWhite) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx - 1.6, ry - 1.6, 0, -Math.PI * 0.85, Math.PI * 0.15);
      ctx.stroke();
    }

    // Soft plush specular highlight dot
    ctx.fillStyle = isWhite ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.20)';
    ctx.beginPath();
    ctx.ellipse(-2.9, -3.1, 3.1, 2.0, -0.42, 0, Math.PI * 2);
    ctx.fill();

    // Subtle bear knuckle dots along front edge of round paw
    ctx.fillStyle = isWhite ? 'rgba(24, 26, 34, 0.16)' : 'rgba(255, 255, 255, 0.14)';
    for (const ty of [-3.7, 0, 3.7]) {
      ctx.beginPath();
      ctx.arc(rx * 0.56, ty, 1.35, 0, Math.PI * 2);
      ctx.fill();
    }

    // Crimson (#E60012) Danganronpa strike halo on impact squash
    if (squash > 0.16) {
      ctx.strokeStyle = `rgba(230, 0, 18, ${(Math.min(1, squash) * 0.62).toFixed(3)})`;
      ctx.lineWidth = 1.65;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx + 1.5, ry + 1.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
    ctx.restore();
  }
}

export { DESPAIR_RED, DESPAIR_RED_DARK };
