<template>
  <main class="page">
    <slot />
  </main>
</template>

<style scoped>
.page {
  height: 100dvh;
  display: grid;
  padding: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
