function [prop]=lrprop(d,prop )
  % Calls adiff, alos, and ascat

third=1/3;

if (prop.mdp~=0)
  prop.dls   = sqrt(2.*prop.he/prop.gme);
  prop.dlsa  = prop.dls(1)+prop.dls(2);
  prop.dla   =  prop.dl(1)+ prop.dl(2);
  prop.tha   = max(prop.the(1)+prop.the(2),-prop.dla*prop.gme);
  prop.wlos  = 0;
  prop.wscat = 0;
  % Error checking - kwx indicates which error was thrown
  if ((prop.wn<0.838) || (prop.wn>210.))     prop.kwx=max(prop.kwx,1); end
  if( (prop.hg(1)<1)  || (prop.hg(1)>1000.)) prop.kwx=max(prop.kwx,1); end
  if( (prop.hg(2)<1)  || (prop.hg(2)>1000.)) prop.kwx=max(prop.kwx,1); end
  if( (abs(prop.the(1))>0.2) || (prop.dl(1)<0.1*prop.dls(1)) || (prop.dl(1)>3*prop.dls(1))) prop.kwx=max(prop.kwx,3); end
  if( (abs(prop.the(2))>0.2) || (prop.dl(2)<0.1*prop.dls(2)) || (prop.dl(2)>3*prop.dls(2))) prop.kwx=max(prop.kwx,3); end

  if( (prop.ens<250)  || (prop.ens>400) || (prop.gme<75e-9) || (prop.gme>250e-9) || (real(prop.zgnd)<abs(imag(prop.zgnd))) || (prop.wn<0.419) || (prop.wn>420)) prop.kwx=4; end;
  if( (prop.hg(1)<0.5) || (prop.hg(1)>3000.)) prop.kwx=4; end
  if( (prop.hg(2)<0.5) || (prop.hg(2)>3000.)) prop.kwx=4; end

  prop.dmin  = abs(prop.he(1)-prop.he(2))/0.2;
  [q, prop] = adiff(0,prop);
  prop.xae  = (prop.wn*prop.gme^2)^(-third);

  d3 = max(prop.dlsa,1.3787*prop.xae+prop.dla);
  d4 = d3+2.7574*prop.xae;
  [a3, prop] = adiff(d3,prop);
  [a4, prop] = adiff(d4,prop);

  prop.emd=(a4-a3)/(d4-d3);

  prop.aed=a3-prop.emd*d3;
  prop.wis=0.021/(0.021+prop.wn*prop.dh/max(10e3,prop.dlsa));
  prop.ascat1=0;
end
if (prop.mdp>=0)
 prop.mdp=0;
 prop.dist=d;
end
if (prop.dist>0.)
  if (prop.dist>1000e3) prop.kwx=max(prop.kwx,1); end;
  if (prop.dist<prop.dmin)   prop.kwx=max(prop.kwx,3); end;
  if ((prop.dist<1e3)|| (prop.dist>2000e3)) prop.kwx=4; end;
end
if (prop.dist<prop.dlsa)
  if (prop.wlos==0)
     d2=prop.dlsa;
     a2=prop.aed+d2*prop.emd;
     d0=1.908*prop.wn*prop.he(1)*prop.he(2);

     if(prop.aed>=0.)
       d0=min(d0,0.5*prop.dla);
       d1=d0+0.25*(prop.dla-d0);
     else
       d1=max(-prop.aed/prop.emd,0.25*prop.dla);
     end
     a1=alos(d1,prop);

     wq=0;
     if (d0<d1)
       a0=alos(d0,prop);
       q=log(d2/d0);
       prop.ak2=max(0.,((d2-d0)*(a1-a0)-(d1-d0)*(a2-a0))/((d2-d0)*log(d1/d0)-(d1-d0)*q));

       wq=( (prop.aed>0.) | (prop.ak2>0.) );
       if (wq)
         prop.ak1=(a2-a0-prop.ak2*q)/(d2-d0);
         if(prop.ak1<0.)
           prop.ak1=0.;
           prop.ak2=max(a2-a0,0)/q;
           if (prop.ak2==0.) prop.ak1=prop.emd; end
         end
       end
  end
  if (wq==0)
     prop.ak1=max(a2-a1,0)/(d2-d1);
     prop.ak2=0.;
     if(prop.ak1==0.) prop.ak1=prop.emd; end
  end
  prop.ael=a2-prop.ak1*d2-prop.ak2*log(d2);
  prop.wlos=1;
end

  if(prop.dist>0.) prop.aref=prop.ael+prop.ak1*prop.dist+prop.ak2*log(prop.dist); end;

end
if( (prop.dist<=0) || (prop.dist>=prop.dlsa))
  if (prop.wscat==0)
     prop.ad=prop.dl(1)-prop.dl(2);
     prop.rr=prop.he(2)/prop.he(1);
     if (prop.ad<0.)
       prop.ad=-prop.ad;
       prop.rr=1./prop.rr;
     end
     prop.etq=(5.67e-6*prop.ens-2.32e-3)*prop.ens+0.031;
     prop.h0s=-15.;

     d5=prop.dla+200e3;
     d6=d5+200e3;
     [prop]=ascat(d6,prop);
     a6=prop.ascat1;
     [prop]=ascat(d5,prop);
     a5=prop.ascat1;

     if(a5<1000.)
       prop.ems=(a6-a5)/200e3;
       prop.dx=max([prop.dlsa, prop.dla+0.3*prop.xae*log(47.7*prop.wn),(a5-prop.aed-prop.ems*d5)/(prop.emd-prop.ems)]);
       prop.aes=(prop.emd-prop.ems)*prop.dx+prop.aed;

     else
       prop.ems=prop.emd;
       prop.aes=prop.aed;
       prop.dx=10e6;

     end

     prop.wscat=1;
  end
  if(prop.dist>prop.dx)
     prop.aref=prop.aes+prop.ems*prop.dist;
  else
prop.aref=prop.aed+prop.emd*prop.dist;
  end

end

prop.aref=max(prop.aref,0.);