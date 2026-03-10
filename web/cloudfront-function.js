// CloudFront Function para manejar deep linking
// Esta función reescribe las URLs /room/* a /room.html

function handler(event) {
    var request = event.request;
    var uri = request.uri;
    
    // Si la URI es /room/CODIGO, reescribir a /room.html
    if (uri.match(/^\/room\/[A-Z0-9]{6}$/i)) {
        request.uri = '/room.html';
    }
    // Si la URI no tiene extensión, agregar .html
    else if (!uri.includes('.') && uri !== '/') {
        request.uri = uri + '.html';
    }
    // Si la URI termina en /, agregar index.html
    else if (uri.endsWith('/')) {
        request.uri = uri + 'index.html';
    }
    
    return request;
}
