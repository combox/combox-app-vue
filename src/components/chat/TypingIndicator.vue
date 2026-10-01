<template>
  <span class="ti" aria-hidden="true">
    <i class="tiDot" />
    <i class="tiDot" />
    <i class="tiDot" />
  </span>
</template>

<style scoped>
.ti {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  line-height: 1;
}

.tiDot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.5;
  animation: tiBounce 1.2s ease-in-out infinite;
}

.tiDot:nth-child(2) {
  animation-delay: 0.18s;
}

.tiDot:nth-child(3) {
  animation-delay: 0.36s;
}

@keyframes tiBounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.45;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
</style>