
(function(global) {
  'use strict';

  // ── LÍMITES POR PLAN ─────────────────────────────────────────
  // Fuente de verdad — sincronizar con tu backend si cambian
  var PLAN_LIMITS = {
    free:     { products: 10,  orders: 20,   customers: 50,   staff: 0  },
    light:    { products: 30,  orders: 0,    customers: 0,    staff: 0  },
    standard: { products: 100, orders: 500,  customers: 200,  staff: 2  },
    full:     { products: 999, orders: 9999, customers: 9999, staff: 10 }
  };

  // Alerta temprana al llegar al 80% del límite
  var ALERT_AT = 0.80;

  // ── ESTADO INTERNO ────────────────────────────────────────────
  var _planInfo  = {};
  var _counts    = {};
  var _limits    = {};
  var _ready     = false;
  var _callbacks = [];

  // ── INICIALIZACIÓN AUTOMÁTICA ─────────────────────────────────
  document.addEventListener('DOMContentLoaded', function() {
    _init();
  });

  async function _init() {
    _planInfo = _readPlanInfo();
    _limits   = _resolveLimits(_planInfo);

    // Intentar obtener conteos actuales del backend
    var backend  = _getParam('backend') || localStorage.getItem('ld_backend') || '';
    var storeId  = _getParam('store')   || localStorage.getItem('ld_store')   || '';

    if (backend && storeId) {
      try {
        var url = backend + '?action=store.dashboard&storeId=' + storeId;
        var tok = localStorage.getItem('ld_token');
        if (tok) url += '&token=' + encodeURIComponent(tok);
        var r    = await fetch(url);
        var text = await r.text();
        if (!text.trim().startsWith('<')) {
          var d = JSON.parse(text);
          if (d.ok && d.stats) {
            _counts = {
              products:  d.stats.totalProducts  || 0,
              orders:    d.stats.totalOrders     || 0,
              customers: d.stats.totalCustomers  || 0,
              staff:     d.stats.totalStaff      || 0
            };
          }
        }
      } catch(e) {}
    }

    _ready = true;

    // Verificar licencia al cargar
    _checkLicenseOnLoad();

    // Interceptar acciones automáticamente según el HTML actual
    _interceptCurrentPage();

    // Ejecutar callbacks pendientes
    _callbacks.forEach(function(fn) { fn(); });
    _callbacks = [];
  }

  // ── INTERCEPTOR POR PÁGINA ────────────────────────────────────
  function _interceptCurrentPage() {
    var page = location.pathname.split('/').pop().toLowerCase();

    if (page.includes('tienda') || page === 'index.html' || page === '') {
      _interceptTienda();
    }
    if (page.includes('catalogo')) {
      _interceptCatalogo();
    }
    if (page.includes('pedidos')) {
      _interceptPedidos();
    }
    if (page.includes('clientes')) {
      _interceptClientes();
    }
    if (page.includes('panel')) {
      _interceptPanel();
    }
  }

  // ── INTERCEPTORES POR HTML ────────────────────────────────────

  /**
   * TIENDA — intercepta order.create y customer.register
   * Envuelve las funciones globales existentes
   */
  function _interceptTienda() {
    // Interceptar placeOrder (order.create)
    if (typeof global.placeOrder === 'function') {
      var _origPlaceOrder = global.placeOrder;
      global.placeOrder = async function() {
        var check = _check('order.create');
        if (!check.ok) { _showBlock(check); return; }
        if (check.nearLimit) _showWarning(check);
        return _origPlaceOrder.apply(this, arguments);
      };
    }

    // Interceptar submitAuth (customer.register)
    if (typeof global.submitAuth === 'function') {
      var _origSubmitAuth = global.submitAuth;
      global.submitAuth = async function() {
        // Solo verificar en modo registro, no en login
        var mode = global.authMode || 'register';
        if (mode === 'register') {
          var check = _check('customer.register');
          if (!check.ok) { _showBlock(check); return; }
          if (check.nearLimit) _showWarning(check);
        }
        return _origSubmitAuth.apply(this, arguments);
      };
    }
  }

  /**
   * CATÁLOGO — intercepta guardarProducto o saveProduct
   */
  function _interceptCatalogo() {
    var fns = ['guardarProducto', 'saveProduct', 'crearProducto', 'createProduct'];
    fns.forEach(function(fnName) {
      if (typeof global[fnName] === 'function') {
        var _orig = global[fnName];
        global[fnName] = async function() {
          var check = _check('product.create');
          if (!check.ok) { _showBlock(check); return; }
          if (check.nearLimit) _showWarning(check);
          return _orig.apply(this, arguments);
        };
      }
    });
  }

  /**
   * PEDIDOS — solo monitorea, no bloquea (pedidos ya existentes)
   * Muestra aviso si hay demasiados pedidos pendientes sin atender
   */
  function _interceptPedidos() {
    // Ejecutar después de que la página cargue sus datos
    setTimeout(function() {
      var check = _check('order.create');
      if (check.nearLimit || !check.ok) {
        _showBanner(
          !check.ok ? 'danger' : 'warn',
          !check.ok
            ? '⚠️ Límite de pedidos alcanzado (' + check.current + '/' + check.max + '). Actualiza tu plan.'
            : '⚠️ Te quedan ' + check.remaining + ' pedidos disponibles en tu plan.'
        );
      }
    }, 1500);
  }

  /**
   * CLIENTES — intercepta registro y muestra uso actual
   */
  function _interceptClientes() {
    var fns = ['guardarCliente', 'saveCustomer', 'crearCliente', 'createCustomer'];
    fns.forEach(function(fnName) {
      if (typeof global[fnName] === 'function') {
        var _orig = global[fnName];
        global[fnName] = async function() {
          var check = _check('customer.register');
          if (!check.ok) { _showBlock(check); return; }
          if (check.nearLimit) _showWarning(check);
          return _orig.apply(this, arguments);
        };
      }
    });

    // Mostrar uso actual en banner informativo
    setTimeout(function() {
      var check = _check('customer.register');
      if (check.max > 0) {
        _showBanner('info',
          '👥 Clientes: ' + check.current + ' / ' + check.max +
          ' — ' + check.remaining + ' disponibles en tu plan ' + _planLabel()
        );
      }
    }, 1000);
  }

  /**
   * PANEL DUEÑO — muestra resumen de uso de todos los recursos
   * Se inyecta en el dashboard automáticamente
   */
  function _interceptPanel() {
    setTimeout(function() {
      _injectUsageWidget();
    }, 2000); // Esperar a que el dashboard cargue sus datos
  }

  // ── VERIFICADOR CENTRAL ───────────────────────────────────────
  /**
   * Verifica si una acción puede ejecutarse según el plan
   * action: 'product.create' | 'order.create' | 'customer.register' | 'staff.add'
   */
  function _check(action) {
    // Verificar licencia primero
    var lic = _checkLicense();
    if (!lic.ok) {
      return { ok: false, blocked: true, reason: 'license_expired',
               message: lic.message };
    }

    var resourceMap = {
      'product.create':    'products',
      'order.create':      'orders',
      'customer.register': 'customers',
      'staff.add':         'staff'
    };

    var resource = resourceMap[action];
    if (!resource) return { ok: true, blocked: false };

    var current   = _counts[resource]  || 0;
    var max       = _limits[resource]  || 0;

    // Sin límite en este plan para este recurso
    if (max <= 0) return { ok: true, blocked: false, resource: resource, current: current, max: 0 };

    // Bloqueado
    if (current >= max) {
      return {
        ok: false, blocked: true, reason: 'limit_reached',
        resource: resource, current: current, max: max,
        message: 'Límite de ' + _resourceLabel(resource) +
                 ' alcanzado (' + current + '/' + max + '). Actualiza tu plan.'
      };
    }

    // Cerca del límite
    var nearLimit = current >= Math.floor(max * ALERT_AT);
    return {
      ok: true, blocked: false, nearLimit: nearLimit,
      resource: resource, current: current, max: max,
      remaining: max - current,
      message: nearLimit
        ? '⚠️ Te quedan solo ' + (max - current) + ' ' + _resourceLabel(resource) + ' disponibles'
        : null
    };
  }

  // ── LICENCIA ──────────────────────────────────────────────────
  function _checkLicense() {
    var expiry = _planInfo.expiryDate || _planInfo.expiry || _planInfo.licenseExpiry || null;
    if (!expiry) return { ok: true };
    var days = Math.ceil((new Date(expiry) - new Date()) / 86400000);
    if (days <= 0) return { ok: false, message: 'Tu licencia ha vencido. Contacta a tu proveedor para renovarla.' };
    return { ok: true, daysLeft: days };
  }

  function _checkLicenseOnLoad() {
    var lic = _checkLicense();
    if (!lic.ok) {
      _showBanner('danger', '🔒 ' + lic.message);
      return;
    }
    if (lic.daysLeft && lic.daysLeft <= 7) {
      _showBanner('warn',
        '⏳ Tu licencia vence en ' + lic.daysLeft + ' día' + (lic.daysLeft === 1 ? '' : 's') +
        '. Contacta a tu proveedor para renovarla.'
      );
    }
  }

  // ── WIDGET DE USO EN PANEL ────────────────────────────────────
  function _injectUsageWidget() {
    // Solo inyectar si hay datos
    var hasData = Object.keys(_counts).some(function(k) { return _counts[k] > 0; });
    if (!hasData && !Object.keys(_limits).some(function(k) { return _limits[k] > 0; })) return;

    // Buscar punto de inserción en el dashboard
    var dash = document.querySelector('.dash') || document.querySelector('.content') || document.body;
    if (!dash) return;

    // No duplicar
    if (document.getElementById('lk-usage-widget')) return;

    var resources = [
      { key: 'products',  label: '🛍️ Productos',  icon: '🛍️' },
      { key: 'orders',    label: '📦 Pedidos',    icon: '📦' },
      { key: 'customers', label: '👥 Clientes',   icon: '👥' }
    ];

    var rows = resources.map(function(r) {
      var current = _counts[r.key]  || 0;
      var max     = _limits[r.key]  || 0;
      if (max <= 0) return ''; // Sin límite, no mostrar

      var pct   = Math.min(100, Math.round((current / max) * 100));
      var color = pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#16a34a';

      return '<div style="margin-bottom:10px">' +
        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">' +
          '<span>' + r.icon + ' ' + r.label.split(' ')[1] + '</span>' +
          '<span style="font-weight:700;color:' + color + '">' + current + ' / ' + max + '</span>' +
        '</div>' +
        '<div style="height:6px;background:#e8e8e2;border-radius:99px;overflow:hidden">' +
          '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:99px;transition:width .4s"></div>' +
        '</div>' +
      '</div>';
    }).join('');

    if (!rows.replace(/\s/g, '')) return;

    var widget = document.createElement('div');
    widget.id = 'lk-usage-widget';
    widget.style.cssText = 'background:#fff;border:1.5px solid #e8e8e2;border-radius:14px;padding:16px;margin-bottom:14px';
    widget.innerHTML =
      '<div style="font-family:\'Syne\',sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:12px">' +
        '📊 Uso del plan ' + _planLabel() +
      '</div>' +
      rows;

    // Insertar después del banner de licencia si existe, sino al inicio del dash
    var banner = document.getElementById('license-banner-card');
    if (banner && banner.parentNode === dash) {
      banner.insertAdjacentElement('afterend', widget);
    } else {
      dash.insertBefore(widget, dash.firstChild);
    }
  }

  // ── UI — NOTIFICACIONES ───────────────────────────────────────
  /**
   * Banner fijo en la parte superior de la página
   * type: 'danger' | 'warn' | 'info'
   */
  function _showBanner(type, msg) {
    // No duplicar banners del mismo tipo
    var existId = 'lk-banner-' + type;
    if (document.getElementById(existId)) return;

    var colors = {
      danger: { bg:'#fef2f2', border:'#fecaca', text:'#991b1b' },
      warn:   { bg:'#fffbeb', border:'#fde68a', text:'#92400e' },
      info:   { bg:'#eff6ff', border:'#bfdbfe', text:'#1e40af' }
    };
    var c = colors[type] || colors.info;

    var el = document.createElement('div');
    el.id = existId;
    el.style.cssText = [
      'position:sticky;top:56px;z-index:39',
      'background:' + c.bg,
      'border-bottom:1.5px solid ' + c.border,
      'color:' + c.text,
      'padding:10px 16px',
      'font-size:13px;font-weight:600',
      'display:flex;align-items:center;justify-content:space-between;gap:12px'
    ].join(';');

    el.innerHTML = '<span>' + msg + '</span>' +
      '<button onclick="this.parentNode.remove()" style="background:none;border:none;cursor:pointer;font-size:16px;color:' + c.text + ';opacity:.6;padding:0 4px">✕</button>';

    // Insertar después del topbar o al inicio del body
    var topbar = document.querySelector('.topbar') || document.querySelector('header');
    if (topbar && topbar.nextSibling) {
      topbar.parentNode.insertBefore(el, topbar.nextSibling);
    } else {
      document.body.insertBefore(el, document.body.firstChild);
    }
  }

  /**
   * Modal de bloqueo — no se puede cerrar, acción bloqueada
   */
  function _showBlock(check) {
    var overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(0,0,0,.6)',
      'z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px'
    ].join(';');

    overlay.innerHTML =
      '<div style="background:#fff;border-radius:16px;padding:28px 24px;max-width:320px;width:100%;text-align:center">' +
        '<div style="font-size:40px;margin-bottom:12px">' +
          (check.reason === 'license_expired' ? '🔒' : '🚫') +
        '</div>' +
        '<div style="font-family:\'Syne\',sans-serif;font-size:17px;font-weight:800;margin-bottom:8px;color:#1a1a1a">' +
          (check.reason === 'license_expired' ? 'Licencia vencida' : 'Límite alcanzado') +
        '</div>' +
        '<div style="font-size:13px;color:#888;line-height:1.6;margin-bottom:20px">' +
          check.message +
        '</div>' +
        '<button onclick="this.closest(\'div[style*=fixed]\').remove()" ' +
          'style="width:100%;padding:12px;background:#6366f1;color:#fff;border:none;border-radius:10px;' +
          'font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">' +
          'Entendido' +
        '</button>' +
      '</div>';

    document.body.appendChild(overlay);
  }

  /**
   * Toast de advertencia — acción permitida pero cerca del límite
   */
  function _showWarning(check) {
    var toast = document.getElementById('toast');
    if (toast) {
      toast.textContent      = check.message;
      toast.style.background = '#f59e0b';
      toast.style.color      = '#fff';
      toast.style.display    = 'block';
      clearTimeout(toast._gt);
      toast._gt = setTimeout(function() { toast.style.display = 'none'; }, 4000);
    }
  }

  // ── HELPERS ───────────────────────────────────────────────────
  function _readPlanInfo() {
    try { return JSON.parse(localStorage.getItem('ld_plan_info') || '{}'); }
    catch(e) { return {}; }
  }

  function _resolveLimits(info) {
    var plan = (info.plan || (info.catalogOnly ? 'light' : 'standard')).toLowerCase();
    var base = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    // El backend puede enviar maxProducts — respetar si existe
    if (info.maxProducts) base = Object.assign({}, base, { products: info.maxProducts });
    return base;
  }

  function _planLabel() {
    var labels = { free:'Free Trial', light:'Light', standard:'Standard', full:'Full' };
    var info   = _readPlanInfo();
    var p      = (info.plan || (info.catalogOnly ? 'light' : 'standard')).toLowerCase();
    return labels[p] || p;
  }

  function _resourceLabel(key) {
    var labels = { products:'productos', orders:'pedidos', customers:'clientes', staff:'operadores' };
    return labels[key] || key;
  }

  function _getParam(key) {
    return new URLSearchParams(location.search).get(key);
  }

  // ── API PÚBLICA ───────────────────────────────────────────────
  global.LKGuardian = {
    /**
     * Verificar manualmente antes de una acción
     * Uso: if (!LKGuardian.check('product.create').ok) return;
     */
    check: _check,

    /**
     * Actualizar conteos manualmente si el HTML los obtiene
     * Uso: LKGuardian.setCounts({ products: 45, orders: 120 })
     */
    setCounts: function(counts) {
      Object.assign(_counts, counts);
      // Refrescar widget si existe
      var w = document.getElementById('lk-usage-widget');
      if (w) { w.remove(); _injectUsageWidget(); }
    },

    /**
     * Ejecutar cuando el guardian esté listo
     */
    onReady: function(fn) {
      if (_ready) fn();
      else _callbacks.push(fn);
    },

    version: '1.0.0'
  };

})(window);
