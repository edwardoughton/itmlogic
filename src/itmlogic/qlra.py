function [prop]=qlra(kst,prop)
for j=1:2
 if(kst(j)<=0)
   prop.he(j)=prop.hg(j);
 else
   q=4.;
   if(kst(j)~=1) q=9.; end
   if(prop.hg(j)<5.)  q=q*sin(0.3141593*prop.hg(j)); end
   prop.he(j)=prop.hg(j)+(1.+q)*exp(-min(20.,2.*prop.hg(j)/max(1e-3,prop.dh)));
 end
 q      = sqrt(2.*prop.he(j)/prop.gme);
 prop.dl(j)  = q*exp(-0.07*sqrt(prop.dh/max(prop.he(j),5.)));
 prop.the(j) = (0.65*prop.dh*(q/prop.dl(j)-1.)-2.*prop.he(j))/q;
end
prop.mdp=1;
prop.lvar=max(prop.lvar,3);
if(prop.mdvarx>=0)
 prop.mdvar = prop.mdvarx;
 prop.lvar  = max(prop.lvar,4);
end
if(prop.klimx>0)
 prop.klim  = prop.klimx;
 prop.lvar  = 5;
end
