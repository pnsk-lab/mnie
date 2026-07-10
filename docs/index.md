---
layout: page
title: Mnie
description: Self-hosted finance infrastructure.
---

<!-- prettier-ignore-start -->
<main class="mnie-home">
  <div class="mnie-orbit" aria-hidden="true">
    <i></i><i></i><i></i>
  </div>
  <section class="mnie-hero">
    <div class="mnie-mark" aria-hidden="true">
      <span></span>
    </div>
    <p class="mnie-kicker"><span></span> OPEN SOURCE / SELF-HOSTED</p>
    <h1>Mnie<span>.</span></h1>
    <p class="mnie-statement">Your money.<br>Your machine.</p>
    <nav class="mnie-actions" aria-label="Get started">
      <a class="mnie-primary" href="/docs/">Start building <span>↗</span></a>
      <a class="mnie-github" href="https://github.com/pnsk-lab/mnie">GitHub <span>⌁</span></a>
    </nav>
  </section>
  <footer class="mnie-footer" aria-label="Mnie principles">
    <span>01 / OWN</span>
    <span>02 / TYPE</span>
    <span>03 / MOVE</span>
  </footer>
</main>
<!-- prettier-ignore-end -->

<style>
:root {
  --mnie-ink: #18181b;
  --mnie-paper: #f4f1e8;
  --mnie-lime: #c9ff35;
  --mnie-pink: #ff8ec7;
  --mnie-line: rgba(24, 24, 27, 0.18);
}

body:has(.mnie-home) .VPNav,
body:has(.mnie-home) .VPLocalNav,
body:has(.mnie-home) .VPFooter {
  display: none !important;
}

body:has(.mnie-home) .VPContent,
body:has(.mnie-home) .VPPage,
body:has(.mnie-home) .VPDoc,
body:has(.mnie-home) .VPDoc .container,
body:has(.mnie-home) .VPDoc .content,
body:has(.mnie-home) .VPDoc .content-container {
  margin: 0 !important;
  padding: 0 !important;
  max-width: none !important;
}

body {
  background: var(--mnie-paper);
}

.mnie-home {
  position: relative;
  display: grid;
  grid-template-rows: 1fr auto;
  min-height: 100svh;
  overflow: hidden;
  color: var(--mnie-ink);
  background-color: var(--mnie-paper);
  background-image:
    linear-gradient(var(--mnie-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--mnie-line) 1px, transparent 1px);
  background-size: clamp(52px, 6vw, 92px) clamp(52px, 6vw, 92px);
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  isolation: isolate;
}

.mnie-home::before {
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(105deg, rgba(244, 241, 232, 0.25), var(--mnie-paper) 72%);
  content: '';
}

.mnie-hero {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: min(1180px, 100%);
  margin: 0 auto;
  padding: clamp(72px, 10vw, 140px) clamp(24px, 6vw, 88px) 64px;
}

.mnie-mark {
  position: absolute;
  top: clamp(24px, 4vw, 52px);
  left: clamp(24px, 6vw, 88px);
  width: 42px;
  height: 42px;
  border: 2px solid var(--mnie-ink);
  border-radius: 50%;
  background: var(--mnie-lime);
  box-shadow: 5px 5px 0 var(--mnie-ink);
}

.mnie-mark span,
.mnie-mark span::after {
  position: absolute;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--mnie-ink);
  content: '';
}

.mnie-mark span { top: 12px; left: 6px; }
.mnie-mark span::after { left: 16px; }

.mnie-kicker {
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 0 0 18px;
  font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.16em;
}



.mnie-home h1 {
  margin: 0;
  font-size: clamp(76px, 15vw, 210px);
  font-weight: 900;
  line-height: 0.73;
  letter-spacing: -0.09em;
}

.mnie-home h1 span { color: var(--mnie-pink); }

.mnie-statement {
  margin: clamp(28px, 5vw, 58px) 0 0;
  font-size: clamp(30px, 5vw, 68px);
  font-weight: 650;
  line-height: 0.94;
  letter-spacing: -0.055em;
}

.mnie-actions {
  display: flex;
  gap: 12px;
  align-items: stretch;
  margin-top: clamp(34px, 6vw, 68px);
}

.mnie-actions a {
  display: inline-flex;
  gap: 28px;
  align-items: center;
  justify-content: space-between;
  min-width: 190px;
  padding: 15px 18px;
  border: 2px solid var(--mnie-ink);
  color: var(--mnie-ink);
  font-size: 13px;
  font-weight: 750;
  line-height: 1;
  text-decoration: none;
  transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

.mnie-actions a span { font-size: 18px; }

.mnie-primary {
  background: var(--mnie-lime);
  box-shadow: 6px 6px 0 var(--mnie-ink);
}

.mnie-github { background: var(--mnie-paper); }

.mnie-actions a:hover {
  color: var(--mnie-ink);
  transform: translate(-2px, -2px);
  box-shadow: 8px 8px 0 var(--mnie-ink);
}

.mnie-orbit {
  position: absolute;
  top: 12%;
  right: -8vw;
  z-index: -1;
  width: clamp(260px, 40vw, 620px);
  aspect-ratio: 1;
  border: 2px solid var(--mnie-ink);
  border-radius: 50%;
  background: var(--mnie-pink);
  box-shadow: inset 0 0 0 clamp(18px, 3vw, 46px) var(--mnie-paper);
  animation: mnie-float 7s ease-in-out infinite;
}

.mnie-orbit::before,
.mnie-orbit::after {
  position: absolute;
  border: 2px solid var(--mnie-ink);
  border-radius: 50%;
  content: '';
}

.mnie-orbit::before { inset: 22%; background: var(--mnie-lime); }
.mnie-orbit::after { inset: 43%; background: var(--mnie-ink); }

.mnie-orbit i {
  position: absolute;
  z-index: 1;
  width: clamp(12px, 2vw, 26px);
  aspect-ratio: 1;
  border: 2px solid var(--mnie-ink);
  border-radius: 50%;
  background: var(--mnie-paper);
}

.mnie-orbit i:nth-child(1) { top: 9%; left: 22%; }
.mnie-orbit i:nth-child(2) { right: 3%; bottom: 30%; background: var(--mnie-lime); }
.mnie-orbit i:nth-child(3) { bottom: 4%; left: 28%; background: var(--mnie-pink); }

.mnie-footer {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: 2px solid var(--mnie-ink);
  background: var(--mnie-ink);
  color: var(--mnie-paper);
}

.mnie-footer span {
  padding: 13px clamp(16px, 3vw, 40px);
  border-right: 1px solid rgba(244, 241, 232, 0.3);
  font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.18em;
}

.mnie-footer span:last-child { border-right: 0; }

@keyframes mnie-pulse {
  50% { transform: scale(0.65); opacity: 0.6; }
}

@keyframes mnie-float {
  50% { transform: translateY(-14px) rotate(2deg); }
}

@media (max-width: 700px) {
  .mnie-orbit { top: 7%; right: -36vw; opacity: 0.82; }
  .mnie-home h1 { line-height: 0.82; }
  .mnie-statement { line-height: 1; }
  .mnie-actions { flex-direction: column; width: min(100%, 290px); }
  .mnie-footer span { padding-inline: 12px; text-align: center; letter-spacing: 0.1em; }
}

@media (prefers-reduced-motion: reduce) {
  .mnie-orbit,
  .mnie-kicker span { animation: none; }
}
</style>
