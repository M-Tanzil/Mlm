import axios from 'axios';
import { store } from '../store/index.js';
import { logout } from '../features/auth/authSlice.js';
import { start, done } from '../features/loading/loadingSlice.js';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

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
  (err) => {
    store.dispatch(done());
    const isLogin = err.config?.url?.includes('/auth/login');
    if (err.response?.status === 401 && !isLogin) store.dispatch(logout());
    return Promise.reject(err);
  }
);