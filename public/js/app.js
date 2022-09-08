if ( "serviceWorker" in navigator ){
    navigator.serviceWorker.register("/serviceworker.js")
      .then( (reg)=>{console.log("service worker registered",reg)} )
      .catch( (err)=>{console.log("service worker not registered\n"+err)} );  
}
function $(x){return document.querySelector(x);}
