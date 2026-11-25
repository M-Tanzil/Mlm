import axios from 'axios';
import { store } from '../store/index.js';
import { logout, setAuth } from '../features/auth/authSlice.js';
import { start, done } from '../features/loading/loadingSlice.js';

const baseURL = import.meta.env.VITE_API_URL || '/api';
export const api = axios.create({ baseURL });

// One refresh at a time; concurrent 401s share it. Plain axios so it skips these interceptors.
let refreshing = null;
function refreshTokens() {
  refreshing ??= axios
    .post(`${baseURL}/auth/refresh`, { refreshToken: store.getState().auth.refreshToken })
    .then(({ data }) => store.dispatch(setAuth(data)))
    .finally(() => (refreshing = null));
  return refreshing;
}

api.interceptors.request.use((cfg) => {
  store.dispatch(start());
  const token = store.getState().auth.accessToken;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Expired or invalid token: log out, and ProtectedRoute sends the user to /login
api.interceptors.response.use(
  (res) => {
    store.dispatch(done());
    return res;
  },
  async (err) => {
    store.dispatch(done());
    const cfg = err.config;
    const isAuthCall = cfg?.url?.includes('/auth/login');
    if (err.response?.status === 401 && !isAuthCall && !cfg._retried && store.getState().auth.refreshToken) {
      cfg._retried = true;
      try {
        await refreshTokens();
        return api(cfg); // request interceptor attaches the new token
      } catch {
        // fall through to logout
      }
    }
    if (err.response?.status === 401 && !isAuthCall) store.dispatch(logout());
    return Promise.reject(err);
  }
);