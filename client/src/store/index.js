import { configureStore } from '@reduxjs/toolkit';
import auth from '../features/auth/authSlice.js';
import loading from '../features/loading/loadingSlice.js';

export const store = configureStore({ reducer: { auth,loading } });
