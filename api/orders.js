const { put } = require("@vercel/blob");
const crypto = require("node:crypto");

const BANK = { name: "GLOBUS BANK", accountName: "CHUKWU JENNIFER", accountNumber: "8000080000" };
const CATALOGUE_URL = "https://raw.githubusercontent.com/chukwujennifer101-jpg/jennys-digital-hub/main/products.json";

function send(res,status,data){res.setHeader("Cache-Control","no-store");return res.status(status).json(data);}
function clean(value,max){return String(value||"").trim().slice(0,max);}
async function getCatalogue(){
  const response=await fetch(CATALOGUE_URL,{cache:"no-store"});
  if(!response.ok)throw new Error("The product catalogue is temporarily unavailable.");
  return response.json();
}
function priceItems(requested,catalogue){
  if(!Array.isArray(requested)||!requested.length||requested.length>30)throw new Error("Your cart is empty or contains too many items.");
  return requested.map(line=>{
    const quantity=Number(line.quantity);
    if(!Number.isInteger(quantity)||quantity<1||quantity>50)throw new Error("A product quantity is invalid.");
    let product=null;
    for(const item of catalogue){
      if(String(item.id)===String(line.id)&&!Array.isArray(item.options)){product=item;break;}
      const option=(item.options||[]).find(entry=>String(entry.id)===String(line.id));
      if(option){product={...option,category:item.category,parentName:item.name};break;}
    }
    if(!product||product.available===false)throw new Error("One of the selected products is no longer available. Please refresh your cart.");
    if(!Number.isSafeInteger(Number(product.price))||Number(product.price)<1)throw new Error("A selected product needs a confirmed price before checkout.");
    return {id:String(line.id),name:clean(product.parentName?product.parentName+" — "+product.name:product.name,140),quantity,unitPrice:Number(product.price),lineTotal:Number(product.price)*quantity};
  });
}
module.exports=async function handler(req,res){
  if(req.method!=="POST")return send(res,405,{error:"Method not allowed."});
  try{
    if(!process.env.BLOB_READ_WRITE_TOKEN) return send(res,503,{error:"Order storage is not configured. Please try again later."});
    const customer={name:clean(req.body?.customer?.name,100),phone:clean(req.body?.customer?.phone,25),address:clean(req.body?.customer?.address,500)};
    const email=clean(req.body?.customer?.email,150);
    if(customer.name.length<2||customer.phone.length<7||customer.address.length<5||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return send(res,400,{error:"Enter your name, a valid phone number and delivery address."});
    const paymentMethod=clean(req.body?.paymentMethod,30);
    if(!["Bank Transfer","Paystack"].includes(paymentMethod))return send(res,400,{error:"Choose Bank Transfer or Paystack."});
    if(paymentMethod==="Paystack"&&!process.env.PAYSTACK_SECRET_KEY)return send(res,503,{error:"Paystack online payment is not activated yet. Please select Bank Transfer or contact the store."});
    const catalogue=await getCatalogue();
    const items=priceItems(req.body.items,catalogue);
    const total=items.reduce((sum,item)=>sum+item.lineTotal,0);
    if(!Number.isSafeInteger(total)||total<1)return send(res,400,{error:"The order total is invalid."});
    const orderId="JDH-"+Date.now().toString(36).toUpperCase()+"-"+crypto.randomBytes(3).toString("hex").toUpperCase();
    const order={orderId,createdAt:new Date().toISOString(),customer,paymentMethod,items,total,currency:"NGN",orderStatus:"new",paymentStatus:"pending"};
    const path="orders/"+orderId+".json";
    await put(path,JSON.stringify(order),{access:"private",addRandomSuffix:false,contentType:"application/json"});
    if(paymentMethod==="Bank Transfer")return send(res,200,{success:true,orderId,total,paymentMethod,bank:BANK});
    const paystack=await fetch("https://api.paystack.co/transaction/initialize",{
      method:"POST",headers:{"Authorization":"Bearer "+process.env.PAYSTACK_SECRET_KEY,"Content-Type":"application/json"},
      body:JSON.stringify({email:clean(req.body?.customer?.email,150)||customer.phone.replace(/\D/g,"")+"@customer.jennysdigitalhub.invalid",amount:total*100,currency:"NGN",reference:orderId,callback_url:process.env.PAYSTACK_CALLBACK_URL||req.headers.origin+"/payment-return.html",metadata:{orderId,customerName:customer.name,customerPhone:customer.phone}})
    });
    const payment=await paystack.json().catch(()=>({}));
    if(!paystack.ok||!payment.status||!payment.data?.authorization_url)return send(res,502,{error:payment.message||"Paystack could not start this payment. Your order is saved as pending; contact the store before retrying."});
    return send(res,200,{success:true,orderId,total,paymentMethod,authorizationUrl:payment.data.authorization_url});
  }catch(error){return send(res,500,{error:error.message||"Your order could not be created. Please try again."});}
};
