import axios from 'axios';

const apiClient = axios.create({
  baseURL: 'https://api.example.com',
  timeout: 1000
});

apiClient.interceptors.response.use(
  response => response,
  error => {
    // Improved error handling
    console.error('API call failed:', error);
    return Promise.reject(error);
  }
);

export default apiClient;
