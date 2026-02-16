// Vanilla JavaScript implementation of API client
function apiClient(endpoint, options = {}) {
    return fetch(endpoint, options)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .catch(error => {
            console.error('API call failed:', error);
            throw error;
        });
}

// Example usage
apiClient('/api/some-endpoint')
    .then(data => console.log('Data received:', data))
    .catch(error => console.error('Error:', error));
