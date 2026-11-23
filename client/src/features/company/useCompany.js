import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';

/** Company name + logo for the sidebar. Super Admin can change the logo with changeLogo(file). */
export function useCompany() {
  const [company, setCompany] = useState({ name: 'Company', logo_url: null });
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/company').then((r) => setCompany(r.data)).catch(() => {});
  }, []);

  const changeLogo = useCallback(async (file) => {
    setError('');
    const body = new FormData();
    body.append('logo', file);
    try {
      const { data } = await api.put('/company/logo', body);
      setCompany((c) => ({ ...c, logo_url: data.logo_url }));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not upload the logo');
    }
  }, []);

  return { company, changeLogo, error };
}
