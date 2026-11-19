import axios from 'axios';
import { store } from '../store/index.js';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

api.interceptors.request.use((cfg) => {
  const token = store.getState().auth.accessToken;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});
