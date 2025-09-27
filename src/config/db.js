import mongoose from "mongoose";

async function connectDB() {
  try {
   
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true, 
      useUnifiedTopology: true,
    }).then(data => {
      console.log('data');
    });
  } catch (e) { 
    console.log(e);
  }
}
export default connectDB;