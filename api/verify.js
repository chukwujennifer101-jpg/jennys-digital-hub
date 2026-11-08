const { get, put } = require("@vercel/blob");
function send(res,status,data){res.setHeader("Cache-Control","no-store");return res.status(status).json(data);}
module.exports=async function handler(req,res){
  if(req.method!=="GET")return send(res,405,{error:"Method not allowed."});
  const reference=String(req.query?.reference||"").trim();
  if(!/^JDH-[A-Z0-9]+-[A-F0-9]{6}$/.test(reference))return send(res,400,{error:"Invalid payment reference."});
  if(!process.env.PAYSTACK_SECRET_KEY||!process.env.BLOB_READ_WRITE_TOKEN)return send(res,503,{error:"Payment verification is not configured."});
  try{
    const stored=await get("orders/"+reference+".json",{access:"private"});
    if(!stored||stored.statusCode!==200)return send(res,404,{error:"Order not found."});
    const chunks=[];for await(const chunk of stored.stream)chunks.push(Buffer.from(chunk));
    const order=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const response=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(reference),{headers:{Authorization:"Bearer "+process.env.PAYSTACK_SECRET_KEY}});
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.status)return send(res,502,{error:result.message||"Could not verify payment yet."});
    const paid=result.data?.status==="success"&&result.data?.currency==="NGN"&&Number(result.data?.amount)===order.total*100&&result.data?.reference===reference;
    if(paid){order.paymentStatus="paid";order.paidAt=new Date().toISOString();order.paystackTransactionId=String(result.data.id||"");await put("orders/"+reference+".json",JSON.stringify(order),{access:"private",addRandomSuffix:false,contentType:"application/json"});}
    return send(res,200,{success:paid,orderId:reference,paymentStatus:paid?"paid":"pending",message:paid?"Payment confirmed. Your order has been received.":"Payment has not been confirmed. Please do not make another payment until you check with the store."});
  }catch(error){return send(res,500,{error:"We could not verify this payment. Please contact the store with your order reference."});}
};
