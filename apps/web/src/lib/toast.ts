import toast from 'react-hot-toast';

export const showError = (msg: string) =>
  toast.error(msg, { duration: 5000 });

export const showSuccess = (msg: string) =>
  toast.success(msg, { duration: 3000 });

export const showInfo = (msg: string) =>
  toast(msg, { duration: 4000, icon: 'ℹ️' });
