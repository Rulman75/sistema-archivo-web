import axios from 'axios';

let initialized = false;

function handleUnauthorizedRedirect() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.dispatchEvent(new Event('storage'));
}

export function initAuthInterceptors() {
  if (initialized) return;
  initialized = true;

  axios.interceptors.request.use(config => {
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    if (token && config.url && config.url.startsWith('/api') && config.headers) {
      if (!config.headers.get('Authorization')) {
        config.headers.set('Authorization', `Bearer ${token}`);
      }
    }
    return config;
  });

  axios.interceptors.response.use(
    response => response,
    error => {
      const status = error?.response?.status;
      const url = String(error?.config?.url || '');
      if (status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/change-password')) {
        handleUnauthorizedRedirect();
      }
      return Promise.reject(error);
    }
  );

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const isApiCall = urlStr.startsWith('/api') || urlStr.includes('/api/');
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');

    let nextInit = init;
    if (isApiCall && token) {
      const headers = new Headers(init?.headers || {});
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      nextInit = { ...(init || {}), headers };
    }

    const res = await originalFetch(input, nextInit);
    if (
      res.status === 401 &&
      isApiCall &&
      !urlStr.includes('/api/auth/login') &&
      !urlStr.includes('/api/auth/change-password')
    ) {
      handleUnauthorizedRedirect();
    }
    return res;
  };
}

initAuthInterceptors();
