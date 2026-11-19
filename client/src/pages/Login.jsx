import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { setAuth } from '../features/auth/authSlice.js';

export default function Login() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const dispatch = useDispatch();
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    try {
      const { data } = await api.post('/auth/login', { loginId, password });
      dispatch(setAuth(data));
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-slate-100">
      <form onSubmit={submit} className="bg-white p-8 rounded-xl shadow w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <input className="w-full border rounded p-2" placeholder="Login ID" value={loginId}
          onChange={(e) => setLoginId(e.target.value)} />
        <input className="w-full border rounded p-2" type="password" placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)} />
        <button className="w-full bg-indigo-600 text-white rounded p-2">Login</button>
      </form>
    </div>
  );
}
