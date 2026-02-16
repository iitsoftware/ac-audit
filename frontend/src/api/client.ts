import axios from 'axios';

// Create an axios instance with improved error handling
const apiClient = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

apiClient.interceptors.response.use(
  response => response,
  error => {
    // Improved error handling
    console.error('API call error:', error);
    return Promise.reject(error);
  }
);

export default apiClient;
