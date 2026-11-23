import { createSlice } from '@reduxjs/toolkit';

const slice = createSlice({
  name: 'loading',
  initialState: { pending: 0 },
  reducers: {
    startLoading(s) { s.pending += 1; },
    doneLoading(s) { s.pending = Math.max(0, s.pending - 1); },
  },
});

export const { startLoading, doneLoading } = slice.actions;
export default slice.reducer;