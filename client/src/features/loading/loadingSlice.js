import { createSlice } from '@reduxjs/toolkit';

const slice = createSlice({
  name: 'loading',
  initialState: { pending: 0 },
  reducers: {
    start(s) {
      s.pending += 1;
    },
    done(s) {
      s.pending = Math.max(0, s.pending - 1);
    },
  },
});

export const { start, done } = slice.actions;
export default slice.reducer;