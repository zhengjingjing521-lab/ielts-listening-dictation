(() => {
  const namespace = 'ielts:' + document.querySelector('meta[name="practice-scope"]').content + ':';
  window.practiceStorage = {
    getItem(key) { return window.localStorage.getItem(namespace + key); },
    setItem(key, value) { window.localStorage.setItem(namespace + key, value); },
    removeItem(key) { window.localStorage.removeItem(namespace + key); }
  };
})();
