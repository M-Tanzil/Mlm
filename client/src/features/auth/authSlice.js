import { createSlice } from '@reduxjs/toolkit';

const saved = JSON.parse(localStorage.getItem('auth') || 'null');

const slice = createSlice({
  name: 'auth',
  initialState: saved || { accessToken: null, refreshToken: null, role: null },
  reducers: {
    setAuth(_s, { payload }) {
      localStorage.setItem('auth', JSON.stringify(payload));
      return payload;
    },
    logout() {
      localStorage.removeItem('auth');
      return { accessToken: null, refreshToken: null, role: null };
    },
  },
});

export const { setAuth, logout } = slice.actions;
export default slice.reducer;
