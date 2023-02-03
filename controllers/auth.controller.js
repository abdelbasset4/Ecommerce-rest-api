const crypto = require('crypto')

const asyncHandler = require('express-async-handler')
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const sendEmail = require('../utils/sendEmail')
const generateToken = require('../utils/generateToken')
const apiError = require('../utils/apiError')
const {sanitizeUser} = require('../utils/sanitizeData')
const User = require('../models/user.model')


const tokenExiste = (auth)=>{
    if(auth && auth.startsWith('Bearer')){
        return  auth.split(' ')[1];
    }

}
const generateRestCode= ()=>Math.floor(100000 + Math.random() * 900000).toString()
const hashedResetCode = (resetCode)=>crypto.createHash('sha256').update(resetCode).digest('hex')

exports.signup = asyncHandler(async (req,res,next)=>{
    const user = await User.create({
        name: req.body.name,
        email: req.body.email,
        password: req.body.password
    })
    const token = generateToken(user._id,process.env.JWT_EXPIRATION_LOGIN)

    const message = `Hi ${user.name}, There was a request to change your password! If you did not make this request then please ignore this email. Otherwise, please copy this reset code to change your password:` ;
    const htmlCode = `<html><head><title>Verify your Account</title></head><body><h2 style='text-align:center;color:red;font-family:Sans-serif'>Hi ${user.name}</h2>
    <p style='text-align:center;color:black;font-family:Sans-serif;line-height:1.5'>You registered an account on [customer portal], before being able to use your account you need to verify that this is your email address by clicking here:</p>
  <div style="text-align:center"><a href ='http://localhost:3000/api/v1/virefied/${token}' style ='appearance: button;
  background-color: #1652F0;
  margin:auto;
  text
  border: 1px solid #1652F0;
  border-radius: 4px;
  box-sizing: border-box;
  color: #FFFFFF;
  cursor: pointer;
  font-family: Graphik,-apple-system,system-ui,"Segoe UI",Roboto,Oxygen,Ubuntu,Cantarell,"Fira Sans","Droid Sans","Helvetica Neue",sans-serif;
  font-size: 14px;
  line-height: 1.15;
  overflow: visible;
  padding: 12px 16px;
  position: relative;
  text-align: center;
  text-transform: none;
  transition: all 80ms ease-in-out;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  width: fit-content;text-decoration:none;'>Click here</a></div>
 
  <h4 style='text-align:center;color:blue;font-family:Sans-serif'>Full Ecommerce</h4></body></html>`;
    try {
        await sendEmail({
            email:user.email,
            subject:'Verify your Account',
            message,
            html:htmlCode,
        })
    } catch (error) {       
        user.passwordResetCode = undefined;
        user.passwordResetCodeExpired =undefined
        user.passwordResetCodeVerify = undefined
        user.save()
        
        return next(new apiError(`There was a problem to send email`,500))
    }
    res.status(201).json({data:sanitizeUser(user), token})
})

exports.login = asyncHandler(async (req,res,next)=>{
    const user = await User.findOne({email:req.body.email})
    if(!user || !(await bcrypt.compare(req.body.password,user.password))){

        return next(new apiError('there was an error in email or password',401))
    }
    if(!user.active){
        return next(new apiError('The user deactivite ,active your acount first',401))
    }
    const token = generateToken(user._id,process.env.JWT_EXPIRATION_LOGIN)
    res.status(200).json({data:sanitizeUser(user), token})
})

exports.protect = asyncHandler(async (req,res,next)=>{
    // check token exist 
    let token;
    token = tokenExiste(req.headers.authorization)

    if(!token){
        return next(new apiError('you are not login please login first',401))
    }    
    // verify token
    const decoded = jwt.verify(token,process.env.JWT_SECRET)
    // check user with userId is existe
    const currentUser = await User.findById(decoded.userId);
    if(!currentUser){
         return next(new apiError('The user that belong to this token does no longer existe',401))
    }
    

    // check if user change password
    if(currentUser.passwordChangedAt){
        const passwordChangedTimeStemp = parseInt(currentUser.passwordChangedAt / 1000, 10)
        if(passwordChangedTimeStemp > decoded.iat){
            return next(new apiError('The user that changed password please login again ...',401))
        }
    }
    req.user = currentUser
    next();
});

exports.allowedTo = (...roles)=> asyncHandler(async (req,res,next)=>{
    if(!roles.includes(req.user.role)){
        return next(new apiError('You are not allowed to protect this route',403))
    }
    next()
});

exports.forgotPassword = asyncHandler(async (req,res,next)=>{
    // find user by email
    const user = await User.findOne({email:req.body.email})
    if(!user){
        return next(new apiError(`There is no user for this email ${req.body.email}`,404))
    }
    // if user existe generate ramdom code 6 digits and save it in db 
    const resetCode = generateRestCode();
    const resetCodeHashed = hashedResetCode(resetCode);

    user.passwordResetCode = resetCodeHashed;
    user.passwordResetCodeExpired = Date.now() + 10*60*1000;
    user.passwordResetCodeVerify = false

    await user.save();
    
    // Send Email
    const message = `Hi ${user.name}, There was a request to change your password! If you did not make this request then please ignore this email. Otherwise, please copy this reset code to change your password: ${resetCode}` ;
    const htmlCode = `<html><head><title>Reset Password</title></head><body><h2 style='text-align:center;color:red;font-family:Sans-serif'>Hi ${user.name}</h2>
    <p style='text-align:center;color:black;font-family:Sans-serif;line-height:1.5'>There was a request to change your password! If you did not make this request then please ignore this email.</p>
  <p style='text-align:center;color:black;font-family:Sans-serif'>Otherwise, please copy this reset code to change your password</p>
  <h4 style='text-align:center;color:blue;font-family:Sans-serif'>${resetCode}</h4></body></html>`;
    try {
        await sendEmail({
            email:user.email,
            subject:'Your reset code for change password',
            message,
            html:htmlCode,
        })
    } catch (error) {       
        user.passwordResetCode = undefined;
        user.passwordResetCodeExpired =undefined
        user.passwordResetCodeVerify = undefined
        user.save()
        
        return next(new apiError(`There was a problem to send email`,500))
    }
    res.status(200).json({status: 'success'})
});

exports.verifyPassResetCode = asyncHandler(async (req,res,next)=>{
    const resetCodeHashed = hashedResetCode(req.body.resetCode);
    const user = await User.findOne({passwordResetCode:resetCodeHashed,passwordResetCodeExpired:{$gt:Date.now()}});
    if(!user){
        return next(new apiError(`Reset Code invalid or expired`,500))
    }
    user.passwordResetCodeVerify= true;
    user.save()
    res.status(200).json({status: 'reset code success'})

});

exports.activateAccount = asyncHandler(async (req,res,next)=>{
    // verify your email adress after sign up
    const {tokenLink} = req.params;
     // verify token
     const decoded = jwt.verify(tokenLink,process.env.JWT_SECRET)
     // check user with userId is existe
     console.log(decoded.userId);
     const user = await User.findById(decoded.userId);
    if(!user){
        return next(new apiError(`Reset Code invalid or expired`,500))
    }
    user.emailactive= true;
    user.save()
    res.status(200).json({status: 'Email Virified'})

});

exports.sendEmailToActivateAccount = asyncHandler(async (req,res,next)=>{
    // Send Email to deactivate user account
    const message = `Hi  There was a request to change your password! If you did not make this request then please ignore this email. Otherwise, please copy this reset code to change your password: ` ;
    const link = `http://localhost:3000/api/v1/activate/${generateToken(req.body.email,process.env.JWT_EXPIRATION_ACTIVATE)}`
    const htmlCode = `<html><head><title>Activate your account</title></head><body><p style='text-align:center;color:black;font-family:Sans-serif;line-height:1.5>This e-mail is in order to re-activate your account on the Tejara website.</p><p style='text-align:center;color:black;font-family:Sans-serif;line-height:1.5>If you want to reactivate your account, please click on the following link</p><a href='${link}' style='text-decoration:none;color:white;background-color:blue;padding:5px 10px;border-radius:5px;text-align:center'>Click Here</a></body></html>`;
    try {
        await sendEmail({
            email:req.body.email,
            subject:'Activate your account',
            message,
            html:htmlCode,
        })
    } catch (error) {       

        
        return next(new apiError(`There was a problem to send email`,500))
    }
    res.status(200).json({status: 'success',link})
})
exports.activateUserAccount = asyncHandler(async (req, res,next) =>{
    // cancel deactivate account from user account
    const {token} = req.params;
    const decoded = jwt.verify(token,process.env.JWT_SECRET)
    await User.findOneAndUpdate({email:decoded.userId},{
        active:true
    }, { new: true })

    res.status(200).json({status:'Your Account was Activated'})
})


exports.resetPassword = asyncHandler(async (req,res,next)=>{
    const user = await User.findOne({email:req.body.email})
    if(!user){
         return next(new apiError(`There is no user for this email ${req.body.email}`,404))
    }
    if(!user.passwordResetCodeVerify){
        return next(new apiError(`Reset Code not verified`,400))
    }
    if(req.body.password !==req.body.rePassword){
        return next(new apiError(`Your password and rePassword not equals`,400))
    }
    user.password = req.body.password
    user.passwordResetCode = undefined;
    user.passwordResetCodeExpired = undefined;
    user.passwordResetCodeVerify = undefined

    await user.save();
    const token = generateToken(user._id,process.env.JWT_EXPIRATION_LOGIN)
    res.status(200).json({token})


})