/**
 * Browser SDK served at /sdk.js for published pages:
 *
 *   <script src="/sdk.js"></script>
 *   const v = await marsa.kv.get("visits");
 *
 * The site id is read from the page URL (/s/<id>/...). Writes need the site's
 * edit token: pass it once with marsa.auth(token). NEVER hard-code an edit
 * token in a published page (anyone can read the page source); writes are meant
 * for agents, scripts and the site owner, reads for every visitor.
 */
export const SDK_JS = `(function () {
  "use strict";
  var script = document.currentScript;
  var origin = script && script.src ? new URL(script.src).origin : location.origin;
  var m = /\\/s\\/([a-z0-9]{6,32})\\//.exec(location.pathname);
  var site = (script && script.dataset.site) || (m && m[1]) || null;
  var token = null;

  function MarsaError(code, message, status) {
    var e = new Error(message);
    e.name = "MarsaError"; e.code = code; e.status = status;
    return e;
  }
  function base() {
    if (!site) throw MarsaError("NO_SITE", "not running on a Marsa site; set data-site on the script tag", 0);
    return origin + "/api/sites/" + site;
  }
  function call(method, path, body, isJson) {
    var headers = {};
    if (token) headers.Authorization = "Bearer " + token;
    if (isJson) headers["Content-Type"] = "application/json";
    return fetch(base() + path, { method: method, headers: headers, body: body }).then(function (r) {
      if (r.status === 204) return null;
      var ct = r.headers.get("content-type") || "";
      if (!r.ok) {
        return (ct.indexOf("json") >= 0 ? r.json() : Promise.resolve({})).then(function (j) {
          var e = (j && j.error) || {};
          throw MarsaError(e.code || "HTTP_" + r.status, e.message || r.statusText, r.status);
        });
      }
      return ct.indexOf("json") >= 0 ? r.json() : r;
    });
  }

  window.marsa = {
    site: site,
    /** Use an edit token for writes (keep it out of your page source). */
    auth: function (t) { token = t || null; return this; },
    config: function () { return fetch(origin + "/api/config").then(function (r) { return r.json(); }); },
    kv: {
      list: function () { return call("GET", "/kv").then(function (j) { return j.keys; }); },
      get: function (key) {
        return call("GET", "/kv/" + encodeURIComponent(key)).then(function (j) { return j.value; }, function (e) {
          if (e.code === "KEY_NOT_FOUND") return undefined;
          throw e;
        });
      },
      set: function (key, value) {
        return call("PUT", "/kv/" + encodeURIComponent(key), JSON.stringify({ value: value }), true).then(function () { return value; });
      },
      delete: function (key) { return call("DELETE", "/kv/" + encodeURIComponent(key)).then(function () { return true; }); },
    },
    files: {
      list: function () { return call("GET", "/files").then(function (j) { return j.files; }); },
      url: function (id) { return base() + "/files/" + encodeURIComponent(id); },
      upload: function (file, name) {
        var fd = new FormData();
        fd.append("file", file, name || file.name);
        return call("POST", "/files", fd, false).then(function (j) { return j.file; });
      },
      delete: function (id) { return call("DELETE", "/files/" + encodeURIComponent(id)).then(function () { return true; }); },
    },
  };
})();
`;
