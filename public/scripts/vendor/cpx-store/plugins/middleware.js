function o(r){let f=r.map(n=>typeof n=="function"?{fn:n}:n);function u(n,t){return n?typeof n=="string"?t===n||t.startsWith(n+"."):n instanceof RegExp?n.test(t):n(t):!0}return{name:"middleware",onBeforeSet(n,t,i){for(let e of f)u(e.filter,n)&&e.fn(n,t,i)}}}export{o as middlewarePlugin};
//# sourceMappingURL=middleware.js.map
