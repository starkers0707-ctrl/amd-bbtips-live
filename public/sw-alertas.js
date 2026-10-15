'use strict';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var destino = event.notification.data && event.notification.data.url
    ? event.notification.data.url : '/index.html';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (clientes) {
      for (var i = 0; i < clientes.length; i++) {
        if ('focus' in clientes[i]) {
          clientes[i].navigate(destino);
          return clientes[i].focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(destino) : null;
    }));
});
